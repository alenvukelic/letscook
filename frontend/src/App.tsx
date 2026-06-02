import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Editor } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import Underline from "@tiptap/extension-underline";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import DOMPurify from "dompurify";
import { common, createLowlight } from "lowlight";
import { marked } from "marked";

const apiBaseUrl =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8000/api"
    : "/api";
const tokenStorageKey = "letscook.accessToken";
const tokenSessionKey = "letscook.sessionAccessToken";
const languageStorageKey = "letscook.language";
const versionReloadStorageKey = "letscook.lastVersionReload";
const appVersion = "0.9.3";
const lowlight = createLowlight(common);

type Role = "user" | "moderator" | "administrator" | "superadmin";
type ViewMode = "tiles" | "list";
type AuthPanelMode = "login" | "register";
type ProfilePanelMode = "profile" | "password";
type RecipeScope = "all" | "mine" | "favorites";
type ManagementMode = "recipes" | "users" | "backup" | "audit";
type ManagementRecipeView = "unverified" | "latest";
type RecipeSortBy = "created" | "title" | "likes" | "complexity";
type SortDirection = "asc" | "desc";

type User = {
  id: number;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: Role;
  last_login_at: string | null;
};

type ManagedUser = User & {
  banned: boolean;
  created_at: string;
};

type CategoryOption = {
  id: number;
  name: string;
};

type IngredientOption = {
  id: number;
  canonical_name: string;
  name: string;
};

type RecipeMedia = {
  id: number;
  original_filename: string;
  url: string;
  width: number | null;
  height: number | null;
};

type RecipeListItem = {
  id: number;
  title: string;
  language: string;
  servings: number | null;
  prep_time_minutes: number | null;
  author_complexity: number | null;
  likes_count: number;
  rating_average: number | null;
  ratings_count: number;
  user_liked: boolean;
  user_rating: number | null;
  verified: boolean;
  category_name: string | null;
  author_name: string;
  author_username: string;
  hidden: boolean;
  deleted: boolean;
  created_at: string;
  updated_at: string;
  main_image_url: string | null;
  can_edit: boolean;
  can_hide: boolean;
  can_delete: boolean;
  can_verify: boolean;
};

type RecipeIngredient = {
  id: number;
  ingredient_id: number;
  amount: number | null;
  unit: string | null;
  note: string | null;
  ingredient_name: string;
  canonical_name: string;
  sort_order: number;
};

type RecipeDetail = RecipeListItem & {
  category_id: number | null;
  content_markdown: string;
  steps_html: string;
  steps: string[];
  author_id: number;
  ingredients: RecipeIngredient[];
  media: RecipeMedia[];
};

type RecipeFormOptions = {
  categories: CategoryOption[];
  ingredients: IngredientOption[];
  units: { code: string; label: string }[];
};

type RecipeFormIngredient = {
  ingredient_id: number | null;
  ingredient_name: string;
  amount: string;
  unit: string;
  note: string;
};

type RecipeFormState = {
  title: string;
  category_id: string;
  language: string;
  content_markdown: string;
  prep_time_minutes: string;
  servings: string;
  author_complexity: string;
  ingredients: RecipeFormIngredient[];
};

type VersionInfo = {
  version: string;
  changes: string[];
};

type AuditSortBy = "datetime" | "action" | "user" | "ip" | "browser" | "operatingSystem";

type AuditFilters = {
  datetime: string;
  action: string;
  user: string;
  ip: string;
  browser: string;
  operatingSystem: string;
};

type BackupSchedule = {
  enabled: boolean;
  cron_expression: string;
  retention_count: number;
  last_run_at: string | null;
  next_run_at: string | null;
};

type BackupPreset = {
  label: string;
  value: string;
  description: string;
};

type BackupFile = {
  filename: string;
  created_at: string;
  updated_at: string;
  byte_size: number;
  recipe_count: number;
  trigger: string;
  reason: string | null;
  download_url: string;
};

type AuditActor = {
  id: number | null;
  display_name: string | null;
  email: string | null;
  role: Role | null;
};

type AuditAction = {
  id: number;
  created_at: string;
  ip_address: string | null;
  code: string;
  description: string;
  detail: string;
  actor: AuditActor | null;
  target: AuditActor | null;
  extra: Record<string, unknown>;
};

type GuestRequest = {
  id: string;
  created_at: string;
  method: string;
  path: string;
  status_code: number;
  ip_address: string | null;
  user_agent: string | null;
  browser: string | null;
  operating_system: string | null;
  device_type: string | null;
};

type AuditRow = {
  id: string;
  datetime: string;
  action: string;
  user: string;
  ip: string;
  browser: string;
  operatingSystem: string;
};

const backupSchedulePresets: BackupPreset[] = [
  { label: "Svaki dan u 02:00", value: "0 2 * * *", description: "Preporučeno za većinu timova." },
  { label: "Svaki dan u 14:00", value: "0 14 * * *", description: "Dodatna popodnevna kopija." },
  { label: "Svaki ponedjeljak u 02:00", value: "0 2 * * 1", description: "Tjedna kopija za manje aktivne sustave." },
];

type Route =
  | { name: "list" }
  | { name: "detail"; recipeId: number }
  | { name: "new" }
  | { name: "edit"; recipeId: number }
  | { name: "profile" }
  | { name: "management" }
  | { name: "changelog" };

const emptyIngredientRow = (): RecipeFormIngredient => ({
  ingredient_id: null,
  ingredient_name: "",
  amount: "",
  unit: "",
  note: "",
});

const emptyRecipeForm = (): RecipeFormState => ({
  title: "",
  category_id: "",
  language: "hr",
  content_markdown: "",
  prep_time_minutes: "30",
  servings: "4",
  author_complexity: "3",
  ingredients: [emptyIngredientRow()],
});

const navItems = [
  { label: "Svi recepti", icon: "R", path: "/recipes" },
  { label: "Novi recept", icon: "+", path: "/recipes/new" },
];

const languages = [
  { code: "hr", flag: "🇭🇷", label: "Hrvatski" },
  { code: "en", flag: "🇬🇧", label: "English" },
  { code: "de", flag: "🇩🇪", label: "Deutsch" },
];

const recipeScopeLabels: Record<RecipeScope, string> = {
  all: "Svi recepti",
  mine: "Samo moji",
  favorites: "Omiljeni",
};

const recipeSortLabels: Record<RecipeSortBy, string> = {
  created: "Prvo najnoviji",
  title: "Abecedom",
  likes: "Najviše likeova",
  complexity: "Po kompleksnosti",
};

const roleLabels: Record<Role, string> = {
  user: "Korisnik",
  moderator: "Moderator",
  administrator: "Administrator",
  superadmin: "Superadmin",
};

function assignableRoles(actor: User | null): Role[] {
  if (actor?.role === "superadmin") {
    return ["user", "moderator", "administrator"];
  }
  if (actor?.role === "administrator") {
    return ["user", "moderator"];
  }
  return [];
}

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getStoredToken(): string | null {
  return localStorage.getItem(tokenStorageKey) ?? sessionStorage.getItem(tokenSessionKey);
}

function clearStoredToken() {
  localStorage.removeItem(tokenStorageKey);
  sessionStorage.removeItem(tokenSessionKey);
}

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#/, "") || "/recipes";
  const parts = hash.split("/").filter(Boolean);

  if (parts[0] === "profile") {
    return { name: "profile" };
  }

  if (parts[0] === "management") {
    return { name: "management" };
  }

  if (parts[0] === "changelog") {
    return { name: "changelog" };
  }

  if (parts[0] !== "recipes") {
    return { name: "list" };
  }
  if (parts.length === 1) {
    return { name: "list" };
  }
  if (parts[1] === "new") {
    return { name: "new" };
  }

  const recipeId = Number(parts[1]);
  if (!Number.isFinite(recipeId)) {
    return { name: "list" };
  }
  if (parts[2] === "edit") {
    return { name: "edit", recipeId };
  }
  return { name: "detail", recipeId };
}

function navigate(path: string) {
  window.location.hash = path;
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    if (!(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(payload?.detail ?? `Request failed with ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}

function formFromRecipe(recipe: RecipeDetail): RecipeFormState {
  let contentMarkdown = recipe.content_markdown || recipe.steps_html;
  const firstImage = recipe.media[0];
  if (firstImage && !/!\[[^\]]*\]\([^)]+\)|<img\s+[^>]*src=/i.test(contentMarkdown)) {
    contentMarkdown = `![${firstImage.original_filename}](${firstImage.url})\n\n${contentMarkdown}`.trim();
  }
  return {
    title: recipe.title,
    category_id: recipe.category_id ? String(recipe.category_id) : "",
    language: recipe.language,
    content_markdown: contentMarkdown,
    prep_time_minutes: recipe.prep_time_minutes == null ? "" : String(recipe.prep_time_minutes),
    servings: recipe.servings == null ? "" : String(recipe.servings),
    author_complexity: recipe.author_complexity == null ? "" : String(recipe.author_complexity),
    ingredients: recipe.ingredients.length
      ? recipe.ingredients.map((ingredient) => ({
          ingredient_id: ingredient.ingredient_id,
          ingredient_name: ingredient.ingredient_name,
          amount: ingredient.amount == null ? "" : String(ingredient.amount),
          unit: ingredient.unit ?? "",
          note: ingredient.note ?? "",
        }))
      : [emptyIngredientRow()],
  };
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("hr-HR");
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeFilterValue(value: string): string {
  return value.trim().toLocaleLowerCase("hr-HR");
}

function getAuditBrowser(extra: Record<string, unknown>): string {
  return typeof extra.browser === "string" ? extra.browser : "";
}

function getAuditOperatingSystem(extra: Record<string, unknown>): string {
  return typeof extra.operating_system === "string" ? extra.operating_system : "";
}

function buildAuditRows(actions: AuditAction[], guests: GuestRequest[]): AuditRow[] {
  return [
    ...actions.map((entry) => ({
      id: `action-${entry.id}`,
      datetime: entry.created_at,
      action: entry.detail,
      user: entry.actor?.display_name ?? "",
      ip: entry.ip_address ?? "",
      browser: getAuditBrowser(entry.extra),
      operatingSystem: getAuditOperatingSystem(entry.extra),
    })),
    ...guests.map((entry) => ({
      id: `guest-${entry.id}`,
      datetime: entry.created_at,
      action: `guest.request ${entry.method} ${entry.path}`,
      user: "",
      ip: entry.ip_address ?? "",
      browser: entry.browser ?? "",
      operatingSystem: entry.operating_system ?? "",
    })),
  ];
}

function compareAuditRows(left: AuditRow, right: AuditRow, sortBy: AuditSortBy): number {
  if (sortBy === "datetime") {
    return new Date(left.datetime).getTime() - new Date(right.datetime).getTime();
  }
  return String(left[sortBy] ?? "").localeCompare(String(right[sortBy] ?? ""), "hr", {
    sensitivity: "base",
  });
}

function formatServing(value: number | null): string {
  if (value == null) {
    return "-";
  }
  return Number.isInteger(value) ? String(value) : value.toLocaleString("hr-HR");
}

function formatIngredientAmount(ingredient: RecipeIngredient): string {
  if (ingredient.amount == null) {
    return "";
  }
  const amount = Number.isInteger(ingredient.amount)
    ? String(ingredient.amount)
    : ingredient.amount.toLocaleString("hr-HR");
  return [amount, ingredient.unit].filter(Boolean).join(" ");
}

function renderMarkdown(markdown: string): JSX.Element[] {
  const elements: JSX.Element[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) {
      return;
    }
    const items = listItems;
    listItems = [];
    elements.push(
      <ul key={`list-${elements.length}`}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>,
    );
  };

  markdown.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    if (trimmed.startsWith("# ")) {
      flushList();
      elements.push(<h2 key={`h2-${elements.length}`}>{trimmed.slice(2)}</h2>);
      return;
    }
    if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(<h3 key={`h3-${elements.length}`}>{trimmed.slice(3)}</h3>);
      return;
    }
    if (trimmed.startsWith("- ")) {
      listItems.push(trimmed.slice(2));
      return;
    }
    flushList();
    elements.push(<p key={`p-${elements.length}`}>{trimmed}</p>);
  });

  flushList();
  return elements;
}

function renderRecipeMarkdown(markdown: string, skippedFirstImageUrl?: string | null): string {
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      "h1",
      "h2",
      "h3",
      "p",
      "strong",
      "em",
      "u",
      "ul",
      "ol",
      "li",
      "img",
      "br",
      "a",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "pre",
      "code",
    ],
    ALLOWED_ATTR: ["src", "alt", "title", "href", "target", "rel"],
  });
  const template = document.createElement("template");
  template.innerHTML = safeHtml;
  template.content.querySelectorAll("img").forEach((image) => {
    const src = image.getAttribute("src") ?? "";
    if (!src.startsWith("/media/")) {
      image.remove();
    }
  });

  if (skippedFirstImageUrl) {
    const firstElement = Array.from(template.content.children).find((element) => {
      return element.textContent?.trim() || element.querySelector("img");
    });
    const leadingImage =
      firstElement?.tagName === "IMG"
        ? firstElement
        : firstElement?.tagName === "P" && !firstElement.textContent?.trim()
          ? firstElement.querySelector("img")
          : null;
    if (leadingImage?.getAttribute("src") === skippedFirstImageUrl) {
      (firstElement ?? leadingImage).remove();
    }
  }
  return template.innerHTML;
}

function RecipeMetaStrip({ recipe, className = "" }: { recipe: RecipeListItem; className?: string }) {
  const complexity = recipe.author_complexity;
  return (
    <div class={`recipe-facts ${className}`.trim()} aria-label="Glavne informacije recepta">
      <span title="Za koliko osoba">🍴 {formatServing(recipe.servings)} osoba</span>
      <span title="Vrijeme pripreme">◷ {formatServing(recipe.prep_time_minutes)} min</span>
      <span title="Sviđanja" class={recipe.user_liked ? "liked-fact" : ""}>♥ {recipe.likes_count}</span>
      <span title="Kompleksnost" class="fact-complexity complexity-inline">
        {complexity == null
          ? "-"
          : Array.from({ length: 5 }, (_, index) => (
              <span key={index} class={`spoon-box ${index < complexity ? "filled" : ""}`}>🥄</span>
            ))}
      </span>
      <span title="Ocjena" class="fact-rating">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} class={index < Math.round(recipe.rating_average ?? 0) ? "filled" : ""}>★</span>
        ))}
        <span class="rating-count">({recipe.ratings_count})</span>
      </span>
    </div>
  );
}

function ComplexityPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const numericValue = Number(value);
  const hasValue = Number.isFinite(numericValue) && numericValue >= 1;
  return (
    <div class="complexity-picker" role="group" aria-label="Kompleksnost">
      {Array.from({ length: 5 }, (_, index) => {
        const nextValue = index + 1;
        return (
          <button
            key={nextValue}
            type="button"
            class={hasValue && nextValue <= numericValue ? "selected" : ""}
            onClick={() => onChange(String(nextValue))}
            aria-label={`Kompleksnost ${nextValue}`}
          >
            🥄
          </button>
        );
      })}
    </div>
  );
}

function RichTextEditor({
  value,
  token,
  onChange,
}: {
  value: string;
  token: string | null;
  onChange: (value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestValueRef = useRef(value);

  useEffect(() => {
    if (value === latestValueRef.current) {
      return;
    }
    latestValueRef.current = value;
    if (editorRef.current) {
      editorRef.current.commands.setContent(value || "", { contentType: "markdown", emitUpdate: false });
    }
  }, [value]);

  useEffect(() => {
    if (!containerRef.current || editorRef.current) {
      return;
    }

    editorRef.current = new Editor({
      element: containerRef.current,
      content: latestValueRef.current || "",
      contentType: "markdown",
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        Markdown,
        Underline,
        Image.configure({ inline: false, allowBase64: false }),
        Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        CodeBlockLowlight.configure({ lowlight }),
        Placeholder.configure({
          placeholder: "Upiši postupak pripreme. Možeš koristiti naslove, liste, tablice, kod i slike.",
        }),
      ],
      editorProps: {
        attributes: {
          class: "tiptap-editor-content",
        },
        handleDrop: (_view, event) => {
          const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith("image/"));
          if (!file) {
            return false;
          }
          event.preventDefault();
          void uploadEditorImage(file);
          return true;
        },
        handlePaste: (_view, event) => {
          const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));
          if (!file) {
            return false;
          }
          event.preventDefault();
          void uploadEditorImage(file);
          return true;
        },
        handleClickOn: (_view, _pos, node) => node.type.name === "image",
      },
      onUpdate: ({ editor }) => {
        const nextValue = editor.getMarkdown();
        latestValueRef.current = nextValue;
        onChange(nextValue);
      },
    });
    editorRef.current.commands.unsetAllMarks();

    return () => {
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, []);

  async function uploadEditorImage(blob: Blob | File) {
    if (!token) {
      window.alert("Za upload slike prijavi se u aplikaciju.");
      return;
    }
    const formData = new FormData();
    formData.append("image", blob);
    try {
      const response = await apiRequest<{ url: string }>(
        "/upload",
        { method: "POST", body: formData },
        token,
      );
      editorRef.current?.chain().focus().setImage({ src: response.url, alt: blob instanceof File ? blob.name : "Slika recepta" }).createParagraphNear().run();
    } catch (error) {
      window.alert((error as Error).message);
    }
  }

  function handleImageFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      void uploadEditorImage(file);
    }
    input.value = "";
  }

  return (
    <div class="markdown-editor-wrap">
      <div class="markdown-editor-host">
        <div class="markdown-editor-toolbar" aria-label="Alati za uređivanje postupka">
          <button type="button" title="Bold" aria-label="Bold" onClick={() => editorRef.current?.chain().focus().toggleBold().run()}><strong>B</strong></button>
          <button type="button" title="Italic" aria-label="Italic" onClick={() => editorRef.current?.chain().focus().toggleItalic().run()}><em>I</em></button>
          <button type="button" title="Underline" aria-label="Underline" onClick={() => editorRef.current?.chain().focus().toggleUnderline().run()}><u>U</u></button>
          <button type="button" title="Naslov" aria-label="Naslov" onClick={() => editorRef.current?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
          <button type="button" title="Podnaslov" aria-label="Podnaslov" onClick={() => editorRef.current?.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
          <button type="button" title="Lista" aria-label="Lista" onClick={() => editorRef.current?.chain().focus().toggleBulletList().run()}>•</button>
          <button type="button" title="Brojevi" aria-label="Brojevi" onClick={() => editorRef.current?.chain().focus().toggleOrderedList().run()}>1.</button>
          <button type="button" title="Kod" aria-label="Kod" onClick={() => editorRef.current?.chain().focus().toggleCodeBlock().run()}>Kod</button>
          <button type="button" title="Tablica" aria-label="Tablica" onClick={() => editorRef.current?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</button>
          <button type="button" title="Undo" aria-label="Undo" onClick={() => editorRef.current?.chain().focus().undo().run()}>↶</button>
          <button type="button" title="Redo" aria-label="Redo" onClick={() => editorRef.current?.chain().focus().redo().run()}>↷</button>
          <button type="button" title="Slika" aria-label="Slika" onClick={() => fileInputRef.current?.click()}>Slika</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            class="hidden-file-input"
            onChange={handleImageFileChange}
          />
        </div>
        <div ref={containerRef} />
      </div>
    </div>
  );
}

function IngredientAutocomplete({
  ingredient,
  options,
  units,
  onChange,
}: {
  ingredient: RecipeFormIngredient;
  options: IngredientOption[];
  units: { code: string; label: string }[];
  onChange: (patch: Partial<RecipeFormIngredient>) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const query = ingredient.ingredient_name.trim().toLocaleLowerCase("hr-HR");
  const matches = query
    ? options
        .filter((option) => option.name.toLocaleLowerCase("hr-HR").includes(query))
        .slice(0, 8)
    : [];
  const selectedName = ingredient.ingredient_id
    ? options.find((option) => option.id === ingredient.ingredient_id)?.name
    : null;

  return (
    <div class="ingredient-autocomplete">
      <div class="ingredient-line">
        <input
          placeholder="Sastojak"
          value={ingredient.ingredient_name}
          autoComplete="off"
          role="combobox"
          aria-expanded={isOpen && matches.length > 0}
          onFocus={() => setIsOpen(true)}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          onInput={(event) =>
            onChange({ ingredient_id: null, ingredient_name: (event.currentTarget as HTMLInputElement).value })
          }
        />
        <input
          placeholder="Kol."
          value={ingredient.amount}
          onInput={(event) => onChange({ amount: (event.currentTarget as HTMLInputElement).value })}
        />
        <select value={ingredient.unit} onChange={(event) => onChange({ unit: (event.currentTarget as HTMLSelectElement).value })}>
          <option value="">Mjera</option>
          {units.map((unit) => (
            <option key={unit.code} value={unit.code}>{unit.label}</option>
          ))}
        </select>
        <input
          placeholder="Napomena"
          value={ingredient.note}
          onInput={(event) => onChange({ note: (event.currentTarget as HTMLInputElement).value })}
        />
      </div>
      {selectedName ? <span class="selected-ingredient">Odabrano: {selectedName}</span> : null}
      {isOpen && matches.length ? (
        <div class="ingredient-suggestions">
          {matches.map((option) => (
            <button
              key={option.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange({ ingredient_id: option.id, ingredient_name: option.name });
                setIsOpen(false);
              }}
            >
              {option.name}
            </button>
          ))}
          {matches.every((option) => option.name.toLocaleLowerCase("hr-HR") !== query) ? (
            <span class="new-ingredient-note">Spremanjem će se dodati novi sastojak ako ga ne odabereš.</span>
          ) : null}
        </div>
      ) : query && !selectedName ? (
        <span class="new-ingredient-note">Novi sastojak: {ingredient.ingredient_name}</span>
      ) : null}
    </div>
  );
}

export function App() {
  const [route, setRoute] = useState<Route>(parseRoute());
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [user, setUser] = useState<User | null>(null);
  const [options, setOptions] = useState<RecipeFormOptions>({ categories: [], ingredients: [], units: [] });
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [managedUserRoleDrafts, setManagedUserRoleDrafts] = useState<Record<number, Role>>({});
  const [recipeDetail, setRecipeDetail] = useState<RecipeDetail | null>(null);
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([]);
  const [backupSchedule, setBackupSchedule] = useState<BackupSchedule | null>(null);
  const [auditActions, setAuditActions] = useState<AuditAction[]>([]);
  const [guestRequests, setGuestRequests] = useState<GuestRequest[]>([]);
  const [changelogMarkdown, setChangelogMarkdown] = useState("");
  const [availableVersion, setAvailableVersion] = useState<VersionInfo | null>(null);
  const [language, setLanguage] = useState(localStorage.getItem(languageStorageKey) ?? "hr");
  const [query, setQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [recipeScope, setRecipeScope] = useState<RecipeScope>("all");
  const [recipeSortBy, setRecipeSortBy] = useState<RecipeSortBy>("created");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [managementMode, setManagementMode] = useState<ManagementMode>("recipes");
  const [managementRecipeView, setManagementRecipeView] = useState<ManagementRecipeView>("unverified");
  const [managedRecipeAuthorId, setManagedRecipeAuthorId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tiles");
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [authPanelMode, setAuthPanelMode] = useState<AuthPanelMode>("login");
  const [profilePanelMode, setProfilePanelMode] = useState<ProfilePanelMode>("profile");
  const [headerCompact, setHeaderCompact] = useState(false);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [auditFilters, setAuditFilters] = useState<AuditFilters>({
    datetime: "",
    action: "",
    user: "",
    ip: "",
    browser: "",
    operatingSystem: "",
  });
  const [auditSortBy, setAuditSortBy] = useState<AuditSortBy>("datetime");
  const [auditSortDirection, setAuditSortDirection] = useState<SortDirection>("desc");
  const [saving, setSaving] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("durdica.vukelic@gmail.com");
  const [loginPassword, setLoginPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerDisplayName, setRegisterDisplayName] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [formState, setFormState] = useState<RecipeFormState>(emptyRecipeForm());

  const isModerator =
    user?.role === "moderator" || user?.role === "administrator" || user?.role === "superadmin";
  const isAdmin = user?.role === "administrator" || user?.role === "superadmin";
  const isSuperadmin = user?.role === "superadmin";
  const selectedLanguage = languages.find((item) => item.code === language) ?? languages[0];
  const sortedRecipes = [...recipes].sort((left, right) => {
    let comparison = 0;
    if (recipeSortBy === "title") {
      comparison = left.title.localeCompare(right.title, "hr", { sensitivity: "base" });
    } else if (recipeSortBy === "likes") {
      comparison = left.likes_count - right.likes_count;
    } else if (recipeSortBy === "complexity") {
      const leftComplexity = left.author_complexity;
      const rightComplexity = right.author_complexity;
      if (leftComplexity == null && rightComplexity == null) {
        comparison = 0;
      } else if (leftComplexity == null) {
        comparison = 1;
      } else if (rightComplexity == null) {
        comparison = -1;
      } else {
        comparison = leftComplexity - rightComplexity;
      }
      if (leftComplexity == null || rightComplexity == null) {
        return comparison;
      }
    } else {
      comparison = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });
  const auditRows = buildAuditRows(auditActions, guestRequests)
    .filter((row) => {
      const datetime = row.datetime.toLocaleLowerCase("hr-HR");
      const action = row.action.toLocaleLowerCase("hr-HR");
      const user = row.user.toLocaleLowerCase("hr-HR");
      const ip = row.ip.toLocaleLowerCase("hr-HR");
      const browser = row.browser.toLocaleLowerCase("hr-HR");
      const operatingSystem = row.operatingSystem.toLocaleLowerCase("hr-HR");
      return (
        datetime.includes(normalizeFilterValue(auditFilters.datetime)) &&
        action.includes(normalizeFilterValue(auditFilters.action)) &&
        user.includes(normalizeFilterValue(auditFilters.user)) &&
        ip.includes(normalizeFilterValue(auditFilters.ip)) &&
        browser.includes(normalizeFilterValue(auditFilters.browser)) &&
        operatingSystem.includes(normalizeFilterValue(auditFilters.operatingSystem))
      );
    })
    .sort((left, right) => {
      const comparison = compareAuditRows(left, right, auditSortBy);
      return auditSortDirection === "asc" ? comparison : -comparison;
    });
  const selectedBackupPreset = backupSchedule
    ? backupSchedulePresets.find((preset) => preset.value === backupSchedule.cron_expression) ?? null
    : null;
  const profileAreaRef = useRef<HTMLDivElement>(null);
  const menuAreaRef = useRef<HTMLDivElement>(null);
  const languageAreaRef = useRef<HTMLDivElement>(null);
  const filterAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncRoute = () => setRoute(parseRoute());
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    async function checkVersion() {
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, {
          cache: "reload",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) {
          return;
        }
        const versionInfo = (await response.json()) as VersionInfo;
        if (versionInfo.version && versionInfo.version !== appVersion) {
          setAvailableVersion(versionInfo);
          const reloadMarker = `${appVersion}->${versionInfo.version}`;
          if (localStorage.getItem(versionReloadStorageKey) !== reloadMarker) {
            localStorage.setItem(versionReloadStorageKey, reloadMarker);
            window.location.reload();
          }
        }
      } catch {
        // Version checks should never interrupt normal recipe browsing.
      }
    }

    void checkVersion();
    const onFocus = () => void checkVersion();
    const onVisibilityChange = () => {
      if (!document.hidden) {
        void checkVersion();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(() => void checkVersion(), 60 * 1000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen && !languageOpen && !filterOpen && !profileOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!menuAreaRef.current?.contains(target)) {
        setMenuOpen(false);
      }
      if (!languageAreaRef.current?.contains(target)) {
        setLanguageOpen(false);
      }
      if (!filterAreaRef.current?.contains(target)) {
        setFilterOpen(false);
      }
      if (!profileAreaRef.current?.contains(target)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen, languageOpen, filterOpen, profileOpen]);

  useEffect(() => {
    const onScroll = () => setHeaderCompact(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    localStorage.setItem(languageStorageKey, language);
    setFormState((current) => ({ ...current, language }));
    void apiRequest<RecipeFormOptions>(`/recipes/options?language=${language}`)
      .then(setOptions)
      .catch((error: Error) => setAppError(error.message));
  }, [language]);

  useEffect(() => {
    if (!window.location.hash) {
      navigate("/recipes");
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      clearStoredToken();
      return;
    }

    void apiRequest<User>("/auth/me", {}, token)
      .then((loadedUser) => {
        setUser(loadedUser);
        setProfileEmail(loadedUser.email);
        setProfileDisplayName(loadedUser.display_name);
        setProfileAvatarUrl(loadedUser.avatar_url ?? "");
      })
      .catch(() => {
        clearStoredToken();
        setToken(null);
        setUser(null);
        setProfileOpen(true);
        setAuthPanelMode("login");
        setNotice("Sesija je istekla. Prijavi se ponovno.");
      });
  }, [token]);

  useEffect(() => {
    if (route.name === "list" || (route.name === "management" && managementMode === "recipes")) {
      void loadRecipes();
    }
  }, [token, query, recipeScope, includeHidden, managementMode, managementRecipeView, managedRecipeAuthorId, route, language]);

  useEffect(() => {
    if (route.name === "management" && managementMode === "users" && isAdmin) {
      void loadManagedUsers();
    }
  }, [token, userQuery, managementMode, route, isAdmin]);

  useEffect(() => {
    if (route.name === "management" && managementMode === "backup" && isAdmin) {
      void loadBackupManagement();
    }
  }, [token, managementMode, route, isAdmin]);

  useEffect(() => {
    if (route.name === "management" && managementMode === "audit" && isAdmin) {
      void loadAuditManagement();
    }
  }, [token, managementMode, route, isAdmin]);

  useEffect(() => {
    if (route.name === "detail" || route.name === "edit") {
      void loadRecipeDetail(route.recipeId);
      return;
    }
    setRecipeDetail(null);
    if (route.name === "new") {
      if (!token) {
        requireAuth("Za dodavanje recepta prijavi se u aplikaciju.");
        navigate("/recipes");
        return;
      }
      setFormState({ ...emptyRecipeForm(), language });
    }
    if (route.name === "profile" && !token) {
      requireAuth("Za uređivanje profila prijavi se u aplikaciju.");
      navigate("/recipes");
    }
    if (route.name === "management" && !token) {
      requireAuth("Za upravljanje receptima prijavi se u aplikaciju.");
      navigate("/recipes");
    }
    if (route.name === "management" && user && !isModerator) {
      setNotice("Upravljanje je dostupno samo moderatorima i administratorima.");
      navigate("/recipes");
    }
    if (route.name === "management" && managementMode === "users" && user && !isAdmin) {
      setManagementMode("recipes");
    }
    if (route.name === "management" && managementMode === "backup" && user && !isAdmin) {
      setManagementMode("recipes");
    }
    if (route.name === "management" && managementMode === "audit" && user && !isAdmin) {
      setManagementMode("recipes");
    }
  }, [route, token, language, user, isModerator, isAdmin, isSuperadmin, managementMode]);

  useEffect(() => {
    if (route.name !== "changelog" || changelogMarkdown) {
      return;
    }
    void fetch("/changelog.md")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Changelog nije dostupan.");
        }
        return response.text();
      })
      .then(setChangelogMarkdown)
      .catch((error) => setAppError((error as Error).message));
  }, [route, changelogMarkdown]);

  useEffect(() => {
    if (route.name === "edit" && recipeDetail) {
      setFormState(formFromRecipe(recipeDetail));
    }
  }, [route, recipeDetail]);

  async function loadRecipes() {
    setLoadingRecipes(true);
    setAppError(null);
    const params = new URLSearchParams();
    if (query.trim()) {
      params.set("q", query.trim());
    }
    if (recipeScope === "mine") {
      params.set("mine", "true");
    }
    if (recipeScope === "favorites") {
      params.set("favorites", "true");
    }
    if (isModerator && includeHidden) {
      params.set("include_hidden", "true");
    }
    if (route.name === "management") {
      params.set("include_hidden", "true");
      if (managementRecipeView === "unverified" && !managedRecipeAuthorId) {
        params.set("unverified", "true");
      }
      if (managedRecipeAuthorId) {
        params.set("author_id", String(managedRecipeAuthorId));
      }
    }

    try {
      const list = await apiRequest<RecipeListItem[]>(`/recipes?${params.toString()}`, {}, token);
      setRecipes(list);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setRecipeScope("all");
        setIncludeHidden(false);
        requireAuth("Sesija je istekla. Prijavi se ponovno.");
      } else {
        setAppError((error as Error).message);
      }
    } finally {
      setLoadingRecipes(false);
    }
  }

  async function loadManagedUsers() {
    if (!token || !isAdmin) {
      return;
    }
    setLoadingUsers(true);
    setAppError(null);
    const params = new URLSearchParams();
    if (userQuery.trim()) {
      params.set("q", userQuery.trim());
    }

    try {
      const list = await apiRequest<ManagedUser[]>(`/users?${params.toString()}`, {}, token);
      setManagedUsers(list);
      setManagedUserRoleDrafts(Object.fromEntries(list.map((item) => [item.id, item.role])) as Record<number, Role>);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        requireAuth("Sesija je istekla. Prijavi se ponovno.");
      } else {
        setAppError((error as Error).message);
      }
    } finally {
      setLoadingUsers(false);
    }
  }

  async function loadBackupManagement() {
    if (!token || !isAdmin) {
      return;
    }
    setLoadingBackups(true);
    setAppError(null);
    try {
      const [schedule, backups] = await Promise.all([
        apiRequest<BackupSchedule>("/recipes/backup-schedule", {}, token),
        apiRequest<BackupFile[]>("/recipes/backups", {}, token),
      ]);
      setBackupSchedule(schedule);
      setBackupFiles(backups);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        requireAuth("Sesija je istekla. Prijavi se ponovno.");
      } else {
        setAppError((error as Error).message);
      }
    } finally {
      setLoadingBackups(false);
    }
  }

  async function loadAuditManagement() {
    if (!token || !isAdmin) {
      return;
    }
    setLoadingAudit(true);
    setAppError(null);
    try {
      const [actions, guests] = await Promise.all([
        apiRequest<AuditAction[]>("/audit/actions?limit=100", {}, token),
        apiRequest<GuestRequest[]>("/audit/guests?limit=100", {}, token),
      ]);
      setAuditActions(actions);
      setGuestRequests(guests);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        requireAuth("Sesija je istekla. Prijavi se ponovno.");
      } else {
        setAppError((error as Error).message);
      }
    } finally {
      setLoadingAudit(false);
    }
  }

  function toggleAuditSort(column: AuditSortBy) {
    if (auditSortBy === column) {
      setAuditSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setAuditSortBy(column);
    setAuditSortDirection(column === "datetime" ? "desc" : "asc");
  }

  async function loadRecipeDetail(recipeId: number) {
    setLoadingDetail(true);
    setAppError(null);
    try {
      const detail = await apiRequest<RecipeDetail>(`/recipes/${recipeId}?language=${language}`, {}, token);
      setRecipeDetail(detail);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        requireAuth("Sesija je istekla. Prijavi se ponovno.");
      } else {
        setAppError((error as Error).message);
      }
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleLogin(event: Event) {
    event.preventDefault();
    setAppError(null);
    setNotice(null);

    try {
      const response = await apiRequest<{ access_token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: loginEmail, password: loginPassword, remember_me: rememberMe }),
      });
      clearStoredToken();
      if (rememberMe) {
        localStorage.setItem(tokenStorageKey, response.access_token);
      } else {
        sessionStorage.setItem(tokenSessionKey, response.access_token);
      }
      setToken(response.access_token);
      setUser(response.user);
      setProfileEmail(response.user.email);
      setProfileDisplayName(response.user.display_name);
      setProfileAvatarUrl(response.user.avatar_url ?? "");
      setLoginPassword("");
      setProfileOpen(false);
      setNotice(`Prijavljen si kao ${response.user.display_name}.`);
      setMenuOpen(false);
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  async function handleRegister(event: Event) {
    event.preventDefault();
    setAppError(null);
    setNotice(null);

    try {
      const response = await apiRequest<{ access_token: string; user: User }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: registerEmail,
          display_name: registerDisplayName,
          password: registerPassword,
        }),
      });
      clearStoredToken();
      sessionStorage.setItem(tokenSessionKey, response.access_token);
      setToken(response.access_token);
      setUser(response.user);
      setProfileEmail(response.user.email);
      setProfileDisplayName(response.user.display_name);
      setProfileAvatarUrl(response.user.avatar_url ?? "");
      setRegisterEmail("");
      setRegisterDisplayName("");
      setRegisterPassword("");
      setAuthPanelMode("login");
      setProfileOpen(false);
      setNotice(`Dobro došao/la, ${response.user.display_name}.`);
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  function handleLogout() {
    clearStoredToken();
    setToken(null);
    setUser(null);
    setProfileOpen(false);
    setRecipeScope("all");
    setIncludeHidden(false);
    setNotice("Odjavljen si.");
    navigate("/recipes");
  }

  function handleUserMenu(action: string) {
    setProfileOpen(false);
    if (action === "mine") {
      if (!requireAuth("Za pregled svojih recepata prijavi se u aplikaciju.")) {
        return;
      }
      setRecipeScope("mine");
      navigate("/recipes");
      return;
    }
    if (action === "favorites") {
      if (!requireAuth("Za omiljene recepte prijavi se u aplikaciju.")) {
        return;
      }
      setRecipeScope("favorites");
      navigate("/recipes");
      return;
    }
    if (action === "profile") {
      if (!requireAuth("Za uređivanje profila prijavi se u aplikaciju.")) {
        return;
      }
      setProfilePanelMode("profile");
      navigate("/profile");
      return;
    }
    if (action === "password") {
      if (!requireAuth("Za promjenu lozinke prijavi se u aplikaciju.")) {
        return;
      }
      setProfilePanelMode("password");
      navigate("/profile");
      return;
    }
    if (action === "management") {
      if (!isModerator) {
        setNotice("Upravljanje je dostupno samo moderatorima i administratorima.");
        return;
      }
      setManagementMode("recipes");
      setRecipeScope("all");
      setMenuOpen(false);
      navigate("/management");
    }
  }

  function requireAuth(message: string): boolean {
    if (token) {
      return true;
    }
    clearStoredToken();
    setToken(null);
    setUser(null);
    setAuthPanelMode("login");
    setProfileOpen(true);
    setNotice(message);
    return false;
  }

  async function saveProfile(event: Event) {
    event.preventDefault();
    if (!requireAuth("Sesija je istekla. Prijavi se ponovno za uređivanje profila.")) {
      return;
    }
    setSaving(true);
    setAppError(null);
    try {
      const updated = await apiRequest<User>(
        "/auth/me",
        {
          method: "PUT",
          body: JSON.stringify({
            email: profileEmail,
            display_name: profileDisplayName,
            avatar_url: profileAvatarUrl || null,
          }),
        },
        token,
      );
      setUser(updated);
      setNotice("Profil je spremljen.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        requireAuth("Sesija je istekla. Prijavi se ponovno za uređivanje profila.");
      } else {
        setAppError((error as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function savePassword(event: Event) {
    event.preventDefault();
    if (!requireAuth("Sesija je istekla. Prijavi se ponovno za promjenu lozinke.")) {
      return;
    }
    setSaving(true);
    setAppError(null);
    try {
      await apiRequest<User>(
        "/auth/me/password",
        {
          method: "PUT",
          body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
        },
        token,
      );
      setCurrentPassword("");
      setNewPassword("");
      setNotice("Lozinka je promijenjena.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        requireAuth("Sesija je istekla. Prijavi se ponovno za promjenu lozinke.");
      } else {
        setAppError((error as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  function updateIngredientRow(index: number, patch: Partial<RecipeFormIngredient>) {
    setFormState((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, ingredientIndex) =>
        ingredientIndex === index ? { ...ingredient, ...patch } : ingredient,
      ),
    }));
  }

  function addIngredientRow() {
    setFormState((current) => ({
      ...current,
      ingredients: [...current.ingredients, emptyIngredientRow()],
    }));
  }

  function removeIngredientRow(index: number) {
    setFormState((current) => ({
      ...current,
      ingredients:
        current.ingredients.length === 1
          ? [emptyIngredientRow()]
          : current.ingredients.filter((_, ingredientIndex) => ingredientIndex !== index),
    }));
  }

  async function saveRecipe(event: Event) {
    event.preventDefault();
    if (!requireAuth("Prijava je obavezna za spremanje recepta.")) {
      return;
    }

    setSaving(true);
    setAppError(null);

    if (!formState.prep_time_minutes || !formState.servings || !formState.author_complexity) {
      setSaving(false);
      setAppError("Porcije, vrijeme i kompleksnost moraš upisati prije spremanja.");
      return;
    }

    const payload = {
      title: formState.title,
      category_id: formState.category_id ? Number(formState.category_id) : null,
      language,
      content_markdown: formState.content_markdown,
      prep_time_minutes: Number(formState.prep_time_minutes),
      servings: Number(formState.servings),
      author_complexity: Number(formState.author_complexity),
      ingredients: formState.ingredients
        .filter((ingredient) => ingredient.ingredient_id || ingredient.ingredient_name.trim())
        .map((ingredient) => ({
          ingredient_id: ingredient.ingredient_id,
          ingredient_name: ingredient.ingredient_name.trim() || null,
          amount: ingredient.amount ? Number(ingredient.amount) : null,
          unit: ingredient.unit || null,
          note: ingredient.note || null,
        })),
    };

    try {
      const isEdit = route.name === "edit" && recipeDetail;
      const path = isEdit ? `/recipes/${recipeDetail.id}` : "/recipes";
      const method = isEdit ? "PUT" : "POST";
      const saved = await apiRequest<RecipeDetail>(
        path,
        { method, body: JSON.stringify(payload) },
        token,
      );
      setNotice(isEdit ? "Recept je ažuriran." : "Recept je kreiran.");
      await loadRecipes();
      navigate(`/recipes/${saved.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        requireAuth("Sesija je istekla. Prijavi se ponovno prije spremanja.");
      } else {
        setAppError((error as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function updateVisibility(patch: { hidden?: boolean; deleted?: boolean; verified?: boolean }) {
    if (!recipeDetail || !token) {
      return;
    }
    try {
      const updated = await apiRequest<RecipeDetail>(
        `/recipes/${recipeDetail.id}/visibility`,
        { method: "PATCH", body: JSON.stringify(patch) },
        token,
      );
      setRecipeDetail(updated);
      setNotice("Status recepta je promijenjen.");
      await loadRecipes();
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  async function updateRecipeFromList(
    recipeId: number,
    patch: { hidden?: boolean; deleted?: boolean; verified?: boolean },
  ) {
    if (!token) {
      return;
    }
    try {
      await apiRequest<RecipeDetail>(
        `/recipes/${recipeId}/visibility`,
        { method: "PATCH", body: JSON.stringify(patch) },
        token,
      );
      setNotice("Status recepta je promijenjen.");
      await loadRecipes();
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  async function hardDeleteRecipeFromList(recipe: RecipeListItem) {
    if (!token || !window.confirm(`Trajno obrisati recept "${recipe.title}"? Ovu radnju nije moguće poništiti.`)) {
      return;
    }
    try {
      const headers = new Headers({ Authorization: `Bearer ${token}` });
      const response = await fetch(`${apiBaseUrl}/recipes/${recipe.id}`, { method: "DELETE", headers });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new ApiError(payload?.detail ?? `Request failed with ${response.status}`, response.status);
      }
      setNotice("Recept je trajno obrisan.");
      await loadRecipes();
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  async function updateManagedUserRole(managedUser: ManagedUser, role: Role) {
    if (!token) {
      return;
    }
    try {
      const updated = await apiRequest<ManagedUser>(
        `/users/${managedUser.id}/role`,
        { method: "PATCH", body: JSON.stringify({ role }) },
        token,
      );
      setManagedUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(`Uloga korisnika ${updated.display_name} je ažurirana.`);
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  async function updateManagedUserBan(managedUser: ManagedUser) {
    if (!token) {
      return;
    }
    const banned = !managedUser.banned;
    try {
      const updated = await apiRequest<ManagedUser>(
        `/users/${managedUser.id}/ban`,
        { method: "PATCH", body: JSON.stringify({ banned }) },
        token,
      );
      setManagedUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(banned ? "Korisnik je blokiran." : "Korisnik je odblokiran.");
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  async function resetManagedUserPassword(managedUser: ManagedUser) {
    if (!token) {
      return;
    }
    const password = window.prompt(`Nova lozinka za ${managedUser.display_name} (minimalno 8 znakova):`);
    if (!password) {
      return;
    }
    try {
      await apiRequest<ManagedUser>(
        `/users/${managedUser.id}/password`,
        { method: "PATCH", body: JSON.stringify({ password }) },
        token,
      );
      setNotice("Lozinka korisnika je promijenjena.");
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  function showManagedUserRecipes(managedUser: ManagedUser) {
    setManagedRecipeAuthorId(managedUser.id);
    setManagementRecipeView("latest");
    setManagementMode("recipes");
    setNotice(`Prikazujem recepte korisnika ${managedUser.display_name}.`);
  }

  async function createServerBackup() {
    if (!token || !isAdmin) {
      return;
    }
    try {
      const created = await apiRequest<BackupFile>(
        "/recipes/backups",
        { method: "POST" },
        token,
      );
      setNotice(`Backup je spremljen na server: ${created.filename}.`);
      await loadBackupManagement();
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  async function downloadStoredBackup(filename: string) {
    if (!token || !isAdmin) {
      return;
    }
    try {
      const headers = new Headers({ Authorization: `Bearer ${token}` });
      const response = await fetch(`${apiBaseUrl}/recipes/backups/${filename}`, { headers });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new ApiError(payload?.detail ?? `Request failed with ${response.status}`, response.status);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  async function saveBackupSchedule() {
    if (!token || !isAdmin || !backupSchedule) {
      return;
    }
    try {
      const updated = await apiRequest<BackupSchedule>(
        "/recipes/backup-schedule",
        { method: "PUT", body: JSON.stringify(backupSchedule) },
        token,
      );
      setBackupSchedule(updated);
      setNotice("Raspored backupova je spremljen.");
      await loadBackupManagement();
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  function setBackupPreset(cronExpression: string) {
    if (!backupSchedule) {
      return;
    }
    setBackupSchedule({ ...backupSchedule, enabled: true, cron_expression: cronExpression });
  }

  async function toggleRecipeLike() {
    if (!recipeDetail || !requireAuth("Za označavanje sviđanja prijavi se u aplikaciju.")) {
      return;
    }
    try {
      const updated = await apiRequest<RecipeDetail>(
        `/recipes/${recipeDetail.id}/like`,
        { method: recipeDetail.user_liked ? "DELETE" : "PUT" },
        token,
      );
      setRecipeDetail(updated);
      await loadRecipes();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        requireAuth("Sesija je istekla. Prijavi se ponovno.");
      } else {
        setAppError((error as Error).message);
      }
    }
  }

  async function setRecipeRating(rating: number) {
    if (!recipeDetail || !requireAuth("Za ocjenjivanje recepta prijavi se u aplikaciju.")) {
      return;
    }
    try {
      const updated = await apiRequest<RecipeDetail>(
        `/recipes/${recipeDetail.id}/rating`,
        { method: "PUT", body: JSON.stringify({ rating }) },
        token,
      );
      setRecipeDetail(updated);
      await loadRecipes();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        requireAuth("Sesija je istekla. Prijavi se ponovno.");
      } else {
        setAppError((error as Error).message);
      }
    }
  }

  return (
    <main class="app-shell">
      <div class="page-shell">
        <header class={`page-header ${headerCompact ? "compact-header" : ""}`}>
          <div class="header-left" ref={menuAreaRef}>
            <button
              type="button"
              class="hamburger-button"
              aria-label="Glavni meni"
              aria-expanded={menuOpen}
              onClick={() => {
                setLanguageOpen(false);
                setFilterOpen(false);
                setProfileOpen(false);
                setMenuOpen((current) => !current);
              }}
            >
              <span />
              <span />
              <span />
            </button>
            <button type="button" class="brand-block" onClick={() => { setMenuOpen(false); navigate("/recipes"); }}>
              <span class="brand-mark">LC</span>
              <span class="brand-text">LetsCook</span>
            </button>
            {menuOpen ? (
              <nav class="main-menu-popover panel" aria-label="Glavni meni">
                {[...navItems, ...(isModerator ? [{ label: "Upravljanje", icon: "U", action: "management" }] : [])].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    class="nav-link"
                    onClick={() => {
                      setMenuOpen(false);
                      if ("path" in item) {
                        navigate(item.path);
                        return;
                      }
                      handleUserMenu(item.action);
                    }}
                  >
                    <span class="nav-icon">{item.icon}</span>
                    <span class="nav-label">{item.label}</span>
                  </button>
                ))}
              </nav>
            ) : null}
          </div>

          <div class="header-right">
            <div class="language-picker" ref={languageAreaRef}>
              <button
                type="button"
                class="language-trigger"
                aria-label="Jezik aplikacije"
                aria-expanded={languageOpen}
                onClick={() => {
                  setMenuOpen(false);
                  setFilterOpen(false);
                  setProfileOpen(false);
                  setLanguageOpen((current) => !current);
                }}
              >
                {selectedLanguage.flag}
              </button>
              {languageOpen ? (
                <div class="language-popover panel">
                  {languages.map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      class={item.code === language ? "active" : ""}
                      onClick={() => {
                        setLanguage(item.code);
                        setLanguageOpen(false);
                      }}
                    >
                      <span>{item.flag}</span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div class="profile-area" ref={profileAreaRef}>
              <button
                type="button"
                class="profile-trigger"
                onClick={() => {
                  setMenuOpen(false);
                  setLanguageOpen(false);
                  setFilterOpen(false);
                  setProfileOpen((current) => !current);
                }}
                aria-expanded={profileOpen}
                aria-label={user ? "Korisnički izbornik" : "Prijava"}
              >
                <span class={`profile-avatar ${user?.avatar_url ? "has-image" : ""} ${!user ? "guest-avatar" : ""}`}>
                  {user?.avatar_url ? (
                    <img src={user.avatar_url} alt={user.display_name} />
                  ) : user ? (
                    user.display_name.slice(0, 1).toUpperCase()
                  ) : (
                    <svg viewBox="0 0 48 48" aria-hidden="true" class="guest-icon">
                      <circle cx="24" cy="17" r="9" />
                      <path d="M8 42c2.4-10 8-15 16-15s13.6 5 16 15" />
                    </svg>
                  )}
                </span>
              </button>

              {profileOpen ? (
                <div class="profile-popover panel">
                  {!user ? (
                    <>
                      <div class="popover-switcher">
                        <button
                          type="button"
                          class={`toggle-chip ${authPanelMode === "login" ? "active" : ""}`}
                          onClick={() => setAuthPanelMode("login")}
                        >
                          Prijava
                        </button>
                        <button
                          type="button"
                          class={`toggle-chip ${authPanelMode === "register" ? "active" : ""}`}
                          onClick={() => setAuthPanelMode("register")}
                        >
                          Registracija
                        </button>
                      </div>

                      {authPanelMode === "login" ? (
                        <form class="auth-stack" onSubmit={handleLogin}>
                          <label>
                            Email
                            <input
                              type="email"
                              value={loginEmail}
                              onInput={(event) =>
                                setLoginEmail((event.currentTarget as HTMLInputElement).value)
                              }
                            />
                          </label>
                          <label>
                            Password
                            <input
                              type="password"
                              value={loginPassword}
                              onInput={(event) =>
                                setLoginPassword((event.currentTarget as HTMLInputElement).value)
                              }
                            />
                          </label>
                          <label class="inline-check remember-check">
                            <input
                              type="checkbox"
                              checked={rememberMe}
                              onChange={(event) =>
                                setRememberMe((event.currentTarget as HTMLInputElement).checked)
                              }
                            />
                            <span>Zapamti me</span>
                          </label>
                          <button type="submit" class="primary">
                            Prijava
                          </button>
                        </form>
                      ) : (
                        <form class="auth-stack" onSubmit={handleRegister}>
                          <label>
                            Korisničko ime
                            <input
                              value={registerDisplayName}
                              onInput={(event) =>
                                setRegisterDisplayName(
                                  (event.currentTarget as HTMLInputElement).value,
                                )
                              }
                            />
                          </label>
                          <label>
                            Email
                            <input
                              value={registerEmail}
                              onInput={(event) =>
                                setRegisterEmail((event.currentTarget as HTMLInputElement).value)
                              }
                            />
                          </label>
                          <label>
                            Lozinka
                            <input
                              type="password"
                              value={registerPassword}
                              onInput={(event) =>
                                setRegisterPassword((event.currentTarget as HTMLInputElement).value)
                              }
                            />
                          </label>
                          <button type="submit" class="secondary">
                            Registriraj se
                          </button>
                        </form>
                      )}
                    </>
                  ) : (
                    <div class="auth-stack">
                      <div class="user-summary">
                        <strong>{user.display_name}</strong>
                        <span class="muted">{user.email}</span>
                        <span class="muted">{user.role}</span>
                      </div>
                      <button type="button" class="menu-link" onClick={() => handleUserMenu("profile")}>Profil i podaci</button>
                      <button type="button" class="menu-link" onClick={() => handleUserMenu("password")}>Promjena lozinke</button>
                      <button type="button" class="menu-link" onClick={() => handleUserMenu("favorites")}>Omiljeni recepti</button>
                      <button type="button" class="menu-link" onClick={() => handleUserMenu("mine")}>Moji recepti</button>
                      <button type="button" class="menu-link" onClick={() => navigate("/recipes/new")}>Dodaj recept</button>
                      <button type="button" class="menu-link danger-link" onClick={handleLogout}>Odjava</button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <section class="page-context">
          <p class="eyebrow">LetsCook</p>
          <h1 class="page-title">
            {route.name === "detail"
              ? recipeDetail?.title ?? "Recept"
              : route.name === "edit"
                ? "Uredi recept"
                : route.name === "new"
                  ? "Dodaj novi recept"
                  : route.name === "profile"
                    ? "Profil i podaci"
                    : route.name === "management"
                      ? "Upravljanje"
                      : route.name === "changelog"
                        ? "Changelog"
                        : "Novi i najzanimljiviji recepti"}
          </h1>
        </section>

        {availableVersion ? (
          <div class="version-refresh-banner panel">
            <div>
              <strong>Izašla je novija verzija LetsCooka ({availableVersion.version}).</strong>
              <span> Osvježi stranicu kako bi koristio najnovije izmjene.</span>
              {availableVersion.changes.length ? (
                <ul>
                  {availableVersion.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <button type="button" class="primary" onClick={() => window.location.reload()}>
              Osvježi
            </button>
          </div>
        ) : null}

        {appError ? <div class="alert error">{appError}</div> : null}
        {notice ? <div class="alert notice">{notice}</div> : null}

        {(route.name === "list" || route.name === "management") ? (
          <section class="content-grid">
            <div class="content-main">
              <div class="filter-bar panel">
                {route.name === "list" ? (
                  <>
                    <div class="filter-menu-area" ref={filterAreaRef}>
                      <button
                        type="button"
                        class={`filter-trigger ${filterOpen ? "active" : ""}`}
                        onClick={() => {
                          setMenuOpen(false);
                          setLanguageOpen(false);
                          setProfileOpen(false);
                          setFilterOpen((current) => !current);
                        }}
                        aria-expanded={filterOpen}
                        aria-label="Filteri"
                      >
                        ⛃
                      </button>
                      {filterOpen ? (
                        <div class="filter-popover panel">
                          <label>
                            Prikaz
                            <select
                              value={viewMode}
                              onChange={(event) => setViewMode((event.currentTarget as HTMLSelectElement).value as ViewMode)}
                            >
                              <option value="tiles">Kartice</option>
                              <option value="list">Lista</option>
                            </select>
                          </label>
                          <label>
                            Recepti
                            <select
                              value={recipeScope}
                              onChange={(event) => setRecipeScope((event.currentTarget as HTMLSelectElement).value as RecipeScope)}
                            >
                              <option value="all">{recipeScopeLabels.all}</option>
                              <option value="mine" disabled={!user}>{recipeScopeLabels.mine}</option>
                              <option value="favorites" disabled={!user}>{recipeScopeLabels.favorites}</option>
                            </select>
                          </label>
                          <label>
                            Sortiranje
                            <select
                              value={recipeSortBy}
                              onChange={(event) => setRecipeSortBy((event.currentTarget as HTMLSelectElement).value as RecipeSortBy)}
                            >
                              {Object.entries(recipeSortLabels).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Smjer
                            <select
                              value={sortDirection}
                              onChange={(event) => setSortDirection((event.currentTarget as HTMLSelectElement).value as SortDirection)}
                            >
                              <option value="desc">Silazno</option>
                              <option value="asc">Uzlazno</option>
                            </select>
                          </label>
                        </div>
                      ) : null}
                    </div>
                    <input
                      class="search-input"
                      value={query}
                      placeholder="Pretraži naslove i sastojke"
                      onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
                    />
                  </>
                ) : (
                  <div class="segmented-control" aria-label="Upravljanje">
                    <button
                      type="button"
                      class={managementMode === "recipes" ? "active" : ""}
                      onClick={() => setManagementMode("recipes")}
                    >
                      Recepti
                    </button>
                    {isAdmin ? (
                      <button
                        type="button"
                        class={managementMode === "users" ? "active" : ""}
                        onClick={() => setManagementMode("users")}
                      >
                        Korisnici
                      </button>
                    ) : null}
                    {isAdmin ? (
                      <button
                        type="button"
                        class={managementMode === "backup" ? "active" : ""}
                        onClick={() => setManagementMode("backup")}
                      >
                        Backup
                      </button>
                    ) : null}
                    {isAdmin ? (
                      <button
                        type="button"
                        class={managementMode === "audit" ? "active" : ""}
                        onClick={() => setManagementMode("audit")}
                      >
                        Audit
                      </button>
                    ) : null}
                  </div>
                )}
                {route.name === "list" && isModerator ? (
                  <label class="inline-check">
                    <input
                      type="checkbox"
                      checked={includeHidden}
                      onChange={(event) =>
                        setIncludeHidden((event.currentTarget as HTMLInputElement).checked)
                      }
                    />
                    <span>Prikaži skrivene</span>
                  </label>
                ) : null}
                {route.name === "management" && managementMode === "recipes" ? (
                  <div class="segmented-control compact-control" aria-label="Recepti za upravljanje">
                    <button
                      type="button"
                      class={managementRecipeView === "unverified" && !managedRecipeAuthorId ? "active" : ""}
                      onClick={() => {
                        setManagedRecipeAuthorId(null);
                        setManagementRecipeView("unverified");
                      }}
                    >
                      Neprovjereni
                    </button>
                    <button
                      type="button"
                      class={managementRecipeView === "latest" && !managedRecipeAuthorId ? "active" : ""}
                      onClick={() => {
                        setManagedRecipeAuthorId(null);
                        setManagementRecipeView("latest");
                      }}
                    >
                      Zadnji
                    </button>
                    {managedRecipeAuthorId ? (
                      <button type="button" class="active" onClick={() => setManagedRecipeAuthorId(null)}>
                        Recepti korisnika ×
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {route.name === "management" && managementMode === "users" ? (
                  <input
                    class="user-search"
                    type="search"
                    value={userQuery}
                    onInput={(event) => setUserQuery((event.currentTarget as HTMLInputElement).value)}
                    placeholder="Pretraži korisnike"
                  />
                ) : null}
              </div>

              {route.name === "management" && managementMode === "backup" ? (
                <div class="panel backup-panel">
                  <h2>Backup svih recepata</h2>
                  <p>
                    Backup se prvo sprema na server. Ako želiš lokalnu kopiju, preuzmi je zasebno iz povijesti backupova.
                  </p>
                  <small class="backup-storage-note">
                    Backupovi se spremaju na server u <code>var/backups/recipes</code> unutar aplikacijskog direktorija.
                  </small>
                  {backupSchedule ? (
                    <>
                      <div class="backup-help-box">
                        <strong>Automatizacija</strong>
                        <span>Ne trebaš znati cron. Odaberi jedan od prijedloga ili upiši svoj raspored ako trebaš nešto posebno.</span>
                      </div>
                      <div class="backup-schedule-stack">
                        <label>
                          Automatizacija
                          <select
                            value={backupSchedule.enabled ? selectedBackupPreset?.value ?? "custom" : "off"}
                            onChange={(event) => {
                              const value = (event.currentTarget as HTMLSelectElement).value;
                              if (value === "off") {
                                setBackupSchedule({ ...backupSchedule, enabled: false });
                                return;
                              }
                              if (value === "custom") {
                                setBackupSchedule({ ...backupSchedule, enabled: true });
                                return;
                              }
                              setBackupSchedule({ ...backupSchedule, enabled: true, cron_expression: value });
                            }}
                          >
                            <option value="off">Isključeno</option>
                            {backupSchedulePresets.map((preset) => (
                              <option key={preset.value} value={preset.value} title={preset.description}>
                                {preset.label}
                              </option>
                            ))}
                            <option value="custom">Prilagođeno</option>
                            </select>
                          </label>
                        <div class="backup-schedule-grid">
                          <label>
                            Cron izraz
                            <input
                              value={backupSchedule.cron_expression}
                              onInput={(event) =>
                                setBackupSchedule({
                                  ...backupSchedule,
                                  cron_expression: (event.currentTarget as HTMLInputElement).value,
                                })
                              }
                              placeholder="0 2 * * *"
                            />
                            <small>Npr. `0 2 * * *` znači svaki dan u 02:00.</small>
                          </label>
                          <label>
                            Retencija
                            <input
                              type="number"
                              min="1"
                              value={backupSchedule.retention_count}
                              onInput={(event) =>
                                setBackupSchedule({
                                  ...backupSchedule,
                                  retention_count: Number((event.currentTarget as HTMLInputElement).value) || 1,
                                })
                              }
                            />
                            <small>Broj kopija koje ostaju na serveru.</small>
                          </label>
                        </div>
                        </div>
                      <div class="backup-preset-list">
                        {backupSchedulePresets.map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            class="secondary small-action"
                            onClick={() => setBackupPreset(preset.value)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div class="backup-schedule-status">
                        <span>
                          Zadnje pokretanje: {backupSchedule.last_run_at ? formatDate(backupSchedule.last_run_at) : "-"}
                        </span>
                        <span>
                          Sljedeće pokretanje: {backupSchedule.next_run_at ? formatDate(backupSchedule.next_run_at) : "-"}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div class="empty-card">Učitavam raspored backupova...</div>
                  )}
                  <div class="backup-actions">
                    <button type="button" class="primary" onClick={createServerBackup}>
                      Stvori backup na serveru
                    </button>
                    <button type="button" class="secondary" onClick={saveBackupSchedule} disabled={!backupSchedule}>
                      Spremi raspored
                    </button>
                  </div>
                  <h3>Prethodni backupovi</h3>
                  {loadingBackups ? (
                    <div class="empty-card">Učitavam backupove...</div>
                  ) : backupFiles.length ? (
                    <div class="backup-history-list">
                      {backupFiles.map((file) => (
                        <article key={file.filename} class="backup-history-row">
                          <div class="backup-history-main">
                            <strong title={file.filename}>{file.filename}</strong>
                            <div class="backup-history-meta">
                              <span>{formatDate(file.created_at)}</span>
                              <span>{formatBytes(file.byte_size)}</span>
                              <span>{file.recipe_count} recepata</span>
                              <span>{file.trigger === "manual" ? "ručni backup" : "automatizirani backup"}</span>
                              {file.reason ? <span title={file.reason}>{file.reason}</span> : null}
                            </div>
                          </div>
                          <button type="button" class="secondary small-action" onClick={() => downloadStoredBackup(file.filename)}>
                            Preuzmi
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div class="empty-card">Još nema spremljenih backupova.</div>
                  )}
                </div>
              ) : route.name === "management" && managementMode === "audit" ? (
                <div class="panel audit-panel">
                  <h2>Audit zapis</h2>
                  <p>Prikazuje prijave, izmjene, korisnike, goste i detalje po ID-u.</p>
                  <div class="audit-toolbar">
                    <button type="button" class="secondary small-action" onClick={() => setAuditFilters({ datetime: "", action: "", user: "", ip: "", browser: "", operatingSystem: "" })}>
                      Očisti filtre
                    </button>
                    <span class="management-note">Zapisa: {auditRows.length}</span>
                  </div>
                  {loadingAudit ? (
                    <div class="empty-card">Učitavam audit zapis...</div>
                  ) : auditRows.length ? (
                    <div class="audit-table-wrap">
                      <table class="audit-table">
                        <thead>
                          <tr>
                            <th>
                              <button type="button" class="audit-sort-button" onClick={() => toggleAuditSort("datetime")}>
                                Datetime{auditSortBy === "datetime" ? (auditSortDirection === "asc" ? " ▲" : " ▼") : ""}
                              </button>
                            </th>
                            <th>
                              <button type="button" class="audit-sort-button" onClick={() => toggleAuditSort("action")}>
                                Radnja{auditSortBy === "action" ? (auditSortDirection === "asc" ? " ▲" : " ▼") : ""}
                              </button>
                            </th>
                            <th>
                              <button type="button" class="audit-sort-button" onClick={() => toggleAuditSort("user")}>
                                Korisnik{auditSortBy === "user" ? (auditSortDirection === "asc" ? " ▲" : " ▼") : ""}
                              </button>
                            </th>
                            <th>
                              <button type="button" class="audit-sort-button" onClick={() => toggleAuditSort("ip")}>
                                IP{auditSortBy === "ip" ? (auditSortDirection === "asc" ? " ▲" : " ▼") : ""}
                              </button>
                            </th>
                            <th>
                              <button type="button" class="audit-sort-button" onClick={() => toggleAuditSort("browser")}>
                                Browser{auditSortBy === "browser" ? (auditSortDirection === "asc" ? " ▲" : " ▼") : ""}
                              </button>
                            </th>
                            <th>
                              <button type="button" class="audit-sort-button" onClick={() => toggleAuditSort("operatingSystem")}>
                                OS{auditSortBy === "operatingSystem" ? (auditSortDirection === "asc" ? " ▲" : " ▼") : ""}
                              </button>
                            </th>
                          </tr>
                          <tr class="audit-filter-row">
                            <th>
                              <input value={auditFilters.datetime} onInput={(event) => setAuditFilters((current) => ({ ...current, datetime: (event.currentTarget as HTMLInputElement).value }))} placeholder="Filter" />
                            </th>
                            <th>
                              <input value={auditFilters.action} onInput={(event) => setAuditFilters((current) => ({ ...current, action: (event.currentTarget as HTMLInputElement).value }))} placeholder="Filter" />
                            </th>
                            <th>
                              <input value={auditFilters.user} onInput={(event) => setAuditFilters((current) => ({ ...current, user: (event.currentTarget as HTMLInputElement).value }))} placeholder="Filter" />
                            </th>
                            <th>
                              <input value={auditFilters.ip} onInput={(event) => setAuditFilters((current) => ({ ...current, ip: (event.currentTarget as HTMLInputElement).value }))} placeholder="Filter" />
                            </th>
                            <th>
                              <input value={auditFilters.browser} onInput={(event) => setAuditFilters((current) => ({ ...current, browser: (event.currentTarget as HTMLInputElement).value }))} placeholder="Filter" />
                            </th>
                            <th>
                              <input value={auditFilters.operatingSystem} onInput={(event) => setAuditFilters((current) => ({ ...current, operatingSystem: (event.currentTarget as HTMLInputElement).value }))} placeholder="Filter" />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditRows.map((entry) => (
                            <tr key={entry.id}>
                              <td>{formatDate(entry.datetime)}</td>
                              <td>
                                <strong>{entry.action}</strong>
                              </td>
                              <td>{entry.user}</td>
                              <td>{entry.ip}</td>
                              <td>{entry.browser}</td>
                              <td>{entry.operatingSystem}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div class="empty-card">Nema audit zapisa.</div>
                  )}
                </div>
              ) : route.name === "management" && managementMode === "users" ? (
                <div class="user-management-list panel">
                  <div class="managed-user-grid-header" aria-hidden="true">
                    <span>Korisničko ime</span>
                    <span>Email</span>
                    <span>Zadnja prijava</span>
                    <span>Vrsta korisnika</span>
                    <span>Akcije</span>
                  </div>
                  {managedUsers.map((managedUser) => {
                    const roles = assignableRoles(user);
                    const canManage = managedUser.id !== user?.id && roles.includes(managedUser.role);
                    return (
                      <article key={managedUser.id} class="managed-user-row">
                        <div class="managed-user-cell managed-user-identity">
                          {managedUser.avatar_url ? (
                            <img class="managed-user-avatar" src={managedUser.avatar_url} alt={managedUser.display_name} />
                          ) : (
                            <span class="managed-user-avatar fallback">
                              {managedUser.display_name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <strong>{managedUser.display_name}</strong>
                        </div>
                        <div class="managed-user-cell managed-user-email">{managedUser.email}</div>
                        <div class="managed-user-cell managed-user-last-login">
                          {managedUser.last_login_at ? formatDate(managedUser.last_login_at) : "-"}
                        </div>
                        <div class="managed-user-cell managed-user-role">
                          <select
                            value={managedUserRoleDrafts[managedUser.id] ?? managedUser.role}
                            disabled={!canManage}
                            title="Promijeni vrstu korisnika"
                            aria-label={`Vrsta korisnika za ${managedUser.display_name}`}
                            onChange={(event) =>
                              setManagedUserRoleDrafts((current) => ({
                                ...current,
                                [managedUser.id]: (event.currentTarget as HTMLSelectElement).value as Role,
                              }))
                            }
                          >
                            {roles.map((role) => (
                              <option key={role} value={role}>
                                {roleLabels[role]}
                              </option>
                            ))}
                            {!roles.includes(managedUser.role) ? (
                              <option value={managedUser.role}>{roleLabels[managedUser.role]}</option>
                            ) : null}
                          </select>
                          <span class={`status-tag ${managedUser.banned ? "warning-tag" : ""}`}>
                            {managedUser.banned ? "blokiran" : roleLabels[managedUser.role]}
                          </span>
                        </div>
                        <div class="managed-user-cell managed-user-actions">
                          <button
                            type="button"
                            class="secondary small-action action-with-icon"
                            disabled={!canManage}
                            title={`Postavi novu lozinku za ${managedUser.display_name}`}
                            aria-label={`Postavi lozinku za ${managedUser.display_name}`}
                            onClick={() => resetManagedUserPassword(managedUser)}
                          >
                            <span aria-hidden="true">🔒</span>
                            <span>Lozinka</span>
                          </button>
                          <button
                            type="button"
                            class="secondary small-action action-with-icon"
                            disabled={!canManage || (managedUserRoleDrafts[managedUser.id] ?? managedUser.role) === managedUser.role}
                            title={`Promijeni vrstu korisnika ${managedUser.display_name}`}
                            aria-label={`Promijeni vrstu korisnika ${managedUser.display_name}`}
                            onClick={() => updateManagedUserRole(managedUser, managedUserRoleDrafts[managedUser.id] ?? managedUser.role)}
                          >
                            <span aria-hidden="true">🔁</span>
                            <span>Vrsta</span>
                          </button>
                          <button
                            type="button"
                            class="secondary small-action action-with-icon"
                            disabled={!canManage}
                            title={managedUser.banned ? `Odblokiraj korisnika ${managedUser.display_name}` : `Blokiraj korisnika ${managedUser.display_name}`}
                            aria-label={managedUser.banned ? `Odblokiraj korisnika ${managedUser.display_name}` : `Blokiraj korisnika ${managedUser.display_name}`}
                            onClick={() => updateManagedUserBan(managedUser)}
                          >
                            <span aria-hidden="true">⛔</span>
                            <span>{managedUser.banned ? "Odblokiraj" : "Blokiraj"}</span>
                          </button>
                          <button
                            type="button"
                            class="secondary small-action action-with-icon"
                            title={`Pogledaj recepte korisnika ${managedUser.display_name}`}
                            aria-label={`Pogledaj recepte korisnika ${managedUser.display_name}`}
                            onClick={() => showManagedUserRecipes(managedUser)}
                          >
                            <span aria-hidden="true">📚</span>
                            <span>Recepti</span>
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {!managedUsers.length && !loadingUsers ? <div class="empty-card">Nema korisnika za prikaz.</div> : null}
                </div>
              ) : (
              <div class={viewMode === "tiles" ? "recipe-grid" : "recipe-list-rows"}>
                {sortedRecipes.map((recipe) => (
                  <article key={recipe.id} class={`recipe-card ${viewMode}`}>
                    <button
                      type="button"
                      class={`recipe-card-button ${viewMode}`}
                      onClick={() => navigate(`/recipes/${recipe.id}`)}
                    >
                      {recipe.main_image_url ? (
                        <img class={`recipe-card-image ${viewMode}`} src={recipe.main_image_url} alt={recipe.title} />
                      ) : (
                        <div class={`recipe-card-placeholder ${viewMode}`}>{recipe.title.slice(0, 2)}</div>
                      )}
                      <div class="recipe-card-body">
                        <div class="recipe-card-meta">
                          <span>{recipe.category_name ?? "Bez kategorije"}</span>
                          {recipe.hidden ? <span class="status-tag">hidden</span> : null}
                          {!recipe.verified ? <span class="status-tag warning-tag">neprovjereno</span> : null}
                        </div>
                        <h3>{recipe.title}</h3>
                        <RecipeMetaStrip recipe={recipe} />
                      </div>
                    </button>
                    {route.name === "management" ? (
                      <div class="recipe-card-actions">
                        {recipe.can_verify && !recipe.verified ? (
                          <button
                            type="button"
                            class="primary small-action"
                            onClick={() => updateRecipeFromList(recipe.id, { verified: true })}
                          >
                            Verificiraj
                          </button>
                        ) : null}
                        {recipe.can_hide ? (
                          <button
                            type="button"
                            class="secondary small-action"
                            onClick={() => updateRecipeFromList(recipe.id, { hidden: !recipe.hidden })}
                          >
                            {recipe.hidden ? "Vrati" : "Sakrij"}
                          </button>
                        ) : null}
                        {recipe.can_edit ? (
                          <button
                            type="button"
                            class="secondary small-action"
                            onClick={() => navigate(`/recipes/${recipe.id}/edit`)}
                          >
                            Uredi
                          </button>
                        ) : null}
                        {recipe.can_delete ? (
                          <button
                            type="button"
                            class="secondary small-action danger-action"
                            onClick={() => hardDeleteRecipeFromList(recipe)}
                          >
                            Obriši trajno
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))}
                {!recipes.length && !loadingRecipes ? (
                  <div class="panel empty-card">
                    {recipeScope === "mine"
                      ? "Nema tvojih recepata."
                      : recipeScope === "favorites"
                        ? "Nema omiljenih recepata."
                        : route.name === "management" && managementRecipeView === "unverified" && !managedRecipeAuthorId
                          ? "Nema neprovjerenih recepata."
                          : "Nema recepata za prikaz."}
                  </div>
                ) : null}
              </div>
              )}
            </div>
          </section>
        ) : null}

        {route.name === "detail" ? (
          <section class="detail-view">
            <div class="detail-center panel">
              <div class="detail-toolbar">
                <button type="button" class="ghost" onClick={() => navigate("/recipes")}>
                  Natrag na recepte
                </button>
                <div class="action-row compact">
                  {recipeDetail?.can_edit ? (
                    <button
                      type="button"
                      class="secondary"
                      onClick={() => navigate(`/recipes/${recipeDetail.id}/edit`)}
                    >
                      Uredi
                    </button>
                  ) : null}
                  {recipeDetail?.can_verify && !recipeDetail.verified ? (
                    <button
                      type="button"
                      class="primary"
                      onClick={() => updateVisibility({ verified: true })}
                    >
                      Verificiraj
                    </button>
                  ) : null}
                </div>
              </div>

              {recipeDetail ? (
                <>
                  <div class="detail-header-block">
                    <p class="eyebrow">Recept</p>
                    <h2>{recipeDetail.title}</h2>
                    <div class="meta-strip">
                      <span>{recipeDetail.category_name ?? "Bez kategorije"}</span>
                      {!recipeDetail.verified ? <span class="status-tag warning-tag">neprovjereno</span> : null}
                    </div>
                    <RecipeMetaStrip recipe={recipeDetail} className="detail-facts" />
                    <div class="recipe-actions-strip">
                      <button
                        type="button"
                        class={`like-button ${recipeDetail.user_liked ? "active" : ""}`}
                        onClick={toggleRecipeLike}
                      >
                        ♥ Sviđa mi se
                      </button>
                      <div class="rating-picker" aria-label="Ocijeni recept">
                        {Array.from({ length: 5 }, (_, index) => {
                          const rating = index + 1;
                          return (
                            <button
                              key={rating}
                              type="button"
                              class={rating <= (recipeDetail.user_rating ?? 0) ? "selected" : ""}
                              onClick={() => setRecipeRating(rating)}
                            >
                              ★
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {recipeDetail.media.length ? (
                    <section class="media-gallery">
                      {recipeDetail.media.map((media) => (
                        <img key={media.id} src={media.url} alt={recipeDetail.title} class="gallery-image" />
                      ))}
                    </section>
                  ) : null}

                  <section class="ingredients-panel panel detail-ingredients-inline">
                    <p class="eyebrow">Sastojci</p>
                    <div class="ingredients-stack">
                      {recipeDetail.ingredients.map((ingredient) => (
                        <div key={ingredient.id} class="ingredient-chip-row">
                          <strong class="ingredient-amount">{formatIngredientAmount(ingredient)}</strong>
                          <span class="ingredient-text">
                            {ingredient.ingredient_name}
                            {ingredient.note ? <span class="muted"> ({ingredient.note})</span> : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section class="story-block">
                    <h3>Priprema</h3>
                    <div
                      class="steps-html"
                      dangerouslySetInnerHTML={{
                        __html: renderRecipeMarkdown(
                          recipeDetail.content_markdown || recipeDetail.steps_html,
                          recipeDetail.media[0]?.url ?? null,
                        ),
                      }}
                    />
                  </section>
                </>
              ) : (
                <div class="empty-card">{loadingDetail ? "Učitavam recept..." : "Recept nije pronađen."}</div>
              )}
            </div>
          </section>
        ) : null}

        {route.name === "profile" ? (
          <section class="profile-page panel">
            <div class="popover-switcher profile-tabs">
              <button
                type="button"
                class={`toggle-chip ${profilePanelMode === "profile" ? "active" : ""}`}
                onClick={() => setProfilePanelMode("profile")}
              >
                Profil i podaci
              </button>
              <button
                type="button"
                class={`toggle-chip ${profilePanelMode === "password" ? "active" : ""}`}
                onClick={() => setProfilePanelMode("password")}
              >
                Promjena lozinke
              </button>
            </div>

            {profilePanelMode === "profile" ? (
              <form class="profile-form" onSubmit={saveProfile}>
                <label>
                  Korisničko ime
                  <input
                    value={profileDisplayName}
                    onInput={(event) => setProfileDisplayName((event.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={profileEmail}
                    onInput={(event) => setProfileEmail((event.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <label>
                  Avatar / profilna slika
                  <input
                    placeholder="/media/..."
                    value={profileAvatarUrl}
                    onInput={(event) => setProfileAvatarUrl((event.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                {profileAvatarUrl ? (
                  <div class="profile-avatar-preview">
                    <img src={profileAvatarUrl} alt="Profilna slika" />
                    <span>Koristi samo lokalne slike iz aplikacije koje počinju s /media/.</span>
                  </div>
                ) : null}
                <button type="submit" class="primary" disabled={saving}>
                  {saving ? "Spremam..." : "Spremi profil"}
                </button>
              </form>
            ) : (
              <form class="profile-form" onSubmit={savePassword}>
                <label>
                  Trenutna lozinka
                  <input
                    type="password"
                    value={currentPassword}
                    onInput={(event) => setCurrentPassword((event.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <label>
                  Nova lozinka
                  <input
                    type="password"
                    value={newPassword}
                    onInput={(event) => setNewPassword((event.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <button type="submit" class="primary" disabled={saving}>
                  {saving ? "Spremam..." : "Spremi lozinku"}
                </button>
              </form>
            )}
          </section>
        ) : null}

        {(route.name === "new" || route.name === "edit") ? (
          <section class="editor-layout">
            <form class="panel editor-page" onSubmit={saveRecipe}>
              <div class="detail-toolbar">
                <button
                  type="button"
                  class="ghost"
                  onClick={() =>
                    navigate(route.name === "edit" && recipeDetail ? `/recipes/${recipeDetail.id}` : "/recipes")
                  }
                >
                  Natrag
                </button>
              </div>

              <div class="editor-heading-row">
                <div>
                  <p class="eyebrow">Editor</p>
                  <h2>{route.name === "edit" ? "Uredi recept" : "Novi recept"}</h2>
                </div>
                <span class="muted">Obavezno ispuni naslov, kategoriju, porcije, vrijeme i kompleksnost.</span>
              </div>

              <div class="grid compact-editor-grid">
                <label class="editor-field title-field">
                  <span>Naslov</span>
                  <input
                    required
                    value={formState.title}
                    onInput={(event) =>
                      setFormState((current) => ({
                        ...current,
                        title: (event.currentTarget as HTMLInputElement).value,
                      }))
                    }
                  />
                </label>
                <label class="editor-field compact-select-field">
                  <span>Kategorija</span>
                  <select
                    required
                    value={formState.category_id}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        category_id: (event.currentTarget as HTMLSelectElement).value,
                      }))
                    }
                  >
                    <option value="">Odaberi kategoriju</option>
                    {options.categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label class="editor-field compact-number-field">
                  <span>Porcije</span>
                  <input
                    required
                    type="number"
                    min="1"
                    step="0.5"
                    value={formState.servings}
                    onInput={(event) =>
                      setFormState((current) => ({
                        ...current,
                        servings: (event.currentTarget as HTMLInputElement).value,
                      }))
                    }
                  />
                </label>
                <label class="editor-field compact-number-field">
                  <span>Vrijeme</span>
                  <input
                    required
                    type="number"
                    min="1"
                    max="1440"
                    value={formState.prep_time_minutes}
                    onInput={(event) =>
                      setFormState((current) => ({
                        ...current,
                        prep_time_minutes: (event.currentTarget as HTMLInputElement).value,
                      }))
                    }
                  />
                  <small>min</small>
                </label>
                <label class="editor-field complexity-field">
                  <span>Kompleksnost</span>
                  <ComplexityPicker
                    value={formState.author_complexity}
                    onChange={(author_complexity) =>
                      setFormState((current) => ({ ...current, author_complexity }))
                    }
                  />
                </label>
              </div>

              <div class="editor-ingredients panel">
                <div class="section-head">
                  <h3>Sastojci</h3>
                  <button type="button" class="ghost" onClick={addIngredientRow}>
                    Dodaj red
                  </button>
                </div>
                <div class="editor-ingredient-table">
                  {formState.ingredients.map((ingredient, index) => (
                    <div key={index} class="ingredient-editor-row">
                      <IngredientAutocomplete
                        ingredient={ingredient}
                        options={options.ingredients}
                        units={options.units}
                        onChange={(patch) => updateIngredientRow(index, patch)}
                      />
                      <button type="button" class="ghost danger-link" onClick={() => removeIngredientRow(index)}>
                        Makni
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <section class="editor-procedure-field">
                <h3>Postupak</h3>
                <p class="field-hint">
                  U pripremu postavite prvo sliku gotovog jela, a niže ako je potrebno slike za pripremu.
                </p>
                <RichTextEditor
                  value={formState.content_markdown}
                  token={token}
                  onChange={(content_markdown) =>
                    setFormState((current) => ({ ...current, content_markdown }))
                  }
                />
              </section>
              <div class="editor-save-row">
                <button type="submit" class="primary" disabled={saving}>
                  {saving ? "Spremam..." : "SPREMI"}
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {route.name === "changelog" ? (
          <section class="changelog-view panel">
            {changelogMarkdown ? renderMarkdown(changelogMarkdown) : <p>Učitavam changelog...</p>}
          </section>
        ) : null}

        <footer class="app-footer panel">
          <div>
            <strong>LetsCook v{appVersion}</strong>
            <a class="footer-link" href="#/changelog" target="_blank" rel="noreferrer">
              Changelog za korisnike
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}
