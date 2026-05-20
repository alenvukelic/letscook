import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import Editor from "@toast-ui/editor";
import "@toast-ui/editor/dist/toastui-editor.css";
import DOMPurify from "dompurify";
import { marked } from "marked";

const apiBaseUrl =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8000/api"
    : "/api";
const tokenStorageKey = "letscook.accessToken";
const tokenSessionKey = "letscook.sessionAccessToken";
const languageStorageKey = "letscook.language";
const appVersion = "0.2.6";

type Role = "user" | "moderator" | "administrator" | "superadmin";
type ViewMode = "tiles" | "list";
type AuthPanelMode = "login" | "register";
type ProfilePanelMode = "profile" | "password";
type RecipeScope = "all" | "mine" | "favorites";

type User = {
  id: number;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: Role;
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
  servings: number;
  prep_time_minutes: number;
  author_complexity: number;
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
  { code: "hr", label: "HR" },
  { code: "en", label: "EN" },
  { code: "de", label: "DE" },
];

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
  return {
    title: recipe.title,
    category_id: recipe.category_id ? String(recipe.category_id) : "",
    language: recipe.language,
    content_markdown: recipe.content_markdown || recipe.steps_html,
    prep_time_minutes: String(recipe.prep_time_minutes),
    servings: String(recipe.servings),
    author_complexity: String(recipe.author_complexity),
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

function usernameFromUser(user: User | null): string {
  if (!user) {
    return "Gost";
  }
  return user.email.split("@", 1)[0];
}

function formatServing(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString("hr-HR");
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

function renderRecipeMarkdown(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: ["h1", "h2", "h3", "p", "strong", "em", "u", "ul", "ol", "li", "img", "br"],
    ALLOWED_ATTR: ["src", "alt", "title"],
  });
  const template = document.createElement("template");
  template.innerHTML = safeHtml;
  template.content.querySelectorAll("img").forEach((image) => {
    const src = image.getAttribute("src") ?? "";
    if (!src.startsWith("/media/")) {
      image.remove();
    }
  });
  return template.innerHTML;
}

function RecipeMetaStrip({ recipe, className = "" }: { recipe: RecipeListItem; className?: string }) {
  return (
    <div class={`recipe-facts ${className}`.trim()} aria-label="Glavne informacije recepta">
      <span title="Za koliko osoba">🍴 {formatServing(recipe.servings)} osoba</span>
      <span title="Vrijeme pripreme">◷ {recipe.prep_time_minutes} minuta</span>
      <span title="Sviđanja" class={recipe.user_liked ? "liked-fact" : ""}>♥ {recipe.likes_count}</span>
      <span title="Kompleksnost" class="fact-complexity complexity-inline">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} class={`spoon-box ${index < recipe.author_complexity ? "filled" : ""}`}>🥄</span>
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
  const numericValue = Number(value) || 1;
  return (
    <div class="complexity-picker" role="group" aria-label="Kompleksnost">
      {Array.from({ length: 5 }, (_, index) => {
        const nextValue = index + 1;
        return (
          <button
            key={nextValue}
            type="button"
            class={nextValue <= numericValue ? "selected" : ""}
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
  const latestValueRef = useRef(value);

  useEffect(() => {
    latestValueRef.current = value;
    if (editorRef.current && editorRef.current.getMarkdown() !== value) {
      editorRef.current.setMarkdown(value, false);
    }
  }, [value]);

  useEffect(() => {
    if (!containerRef.current || editorRef.current) {
      return;
    }

    const createToolbarButton = (label: string, className: string, onClick: () => void) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.className = className;
      button.setAttribute("aria-label", label);
      button.addEventListener("click", onClick);
      return button;
    };

    const updateFromEditor = () => {
      const nextValue = editorRef.current?.getMarkdown() ?? latestValueRef.current;
      latestValueRef.current = nextValue;
      onChange(nextValue);
    };

    const headingButton = (level: 1 | 2 | 3) =>
      createToolbarButton(`H${level}`, "toast-heading-button", () => {
        editorRef.current?.focus();
        editorRef.current?.exec("heading", { level });
        updateFromEditor();
      });
    const underlineButton = createToolbarButton("U", "toast-underline-button", () => {
      editorRef.current?.focus();
      document.execCommand("underline");
      updateFromEditor();
    });

    editorRef.current = new Editor({
      el: containerRef.current,
      initialValue: latestValueRef.current,
      initialEditType: "wysiwyg",
      hideModeSwitch: true,
      previewStyle: "vertical",
      height: "420px",
      usageStatistics: false,
      toolbarItems: [
        [
          { name: "heading1", el: headingButton(1) },
          { name: "heading2", el: headingButton(2) },
          { name: "heading3", el: headingButton(3) },
          "bold",
          "italic",
          { name: "underline", el: underlineButton },
        ],
        ["ul", "ol", "image"],
      ],
      events: {
        change: () => {
          const nextValue = editorRef.current?.getMarkdown() ?? "";
          latestValueRef.current = nextValue;
          onChange(nextValue);
        },
      },
      hooks: {
        addImageBlobHook: (blob, callback) => {
          void uploadEditorImage(blob, callback);
        },
      },
    });

    return () => {
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, []);

  async function uploadEditorImage(blob: Blob | File, callback: (url: string, altText: string) => void) {
    if (!token) {
      window.alert("Za upload slike prijavi se u aplikaciju.");
      return;
    }
    const formData = new FormData();
    formData.append("image", blob);
    try {
      const response = await apiRequest<{ url: string }>(
        "/recipes/media",
        { method: "POST", body: formData },
        token,
      );
      callback(response.url, blob instanceof File ? blob.name : "Slika recepta");
    } catch (error) {
      window.alert((error as Error).message);
    }
  }

  return <div ref={containerRef} class="toast-editor-host" />;
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
  const [recipeDetail, setRecipeDetail] = useState<RecipeDetail | null>(null);
  const [changelogMarkdown, setChangelogMarkdown] = useState("");
  const [language, setLanguage] = useState(localStorage.getItem(languageStorageKey) ?? "hr");
  const [query, setQuery] = useState("");
  const [recipeScope, setRecipeScope] = useState<RecipeScope>("all");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [managementMode, setManagementMode] = useState<"latest" | "unverified">("unverified");
  const [viewMode, setViewMode] = useState<ViewMode>("tiles");
  const [profileOpen, setProfileOpen] = useState(false);
  const [authPanelMode, setAuthPanelMode] = useState<AuthPanelMode>("login");
  const [profilePanelMode, setProfilePanelMode] = useState<ProfilePanelMode>("profile");
  const [headerCompact, setHeaderCompact] = useState(false);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
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
  const collapsedNav = route.name === "detail";

  useEffect(() => {
    const syncRoute = () => setRoute(parseRoute());
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

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
    if (route.name === "list" || route.name === "management") {
      void loadRecipes();
    }
  }, [token, query, recipeScope, includeHidden, managementMode, route, language]);

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
  }, [route, token, language, user, isModerator]);

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
      if (managementMode === "unverified") {
        params.set("unverified", "true");
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
      setNotice(`Prijavljen si kao ${usernameFromUser(response.user)}.`);
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  function handleRegister(event: Event) {
    event.preventDefault();
    setNotice(
      `Registracija za ${registerEmail || registerDisplayName || "novog korisnika"} još nije implementirana u backendu.`,
    );
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
      setManagementMode("unverified");
      setRecipeScope("all");
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
      <aside class={`left-rail ${collapsedNav ? "collapsed" : ""}`}>
        <button type="button" class="brand-block" onClick={() => navigate("/recipes")}>
          <span class="brand-mark">LC</span>
          <span class="brand-text">LetsCook</span>
        </button>

        <nav class="main-nav" aria-label="Main navigation">
          {[...navItems, ...(isModerator ? [{ label: "Upravljanje", icon: "U", action: "management" }] : [])].map((item) => (
            <button
              key={item.label}
              type="button"
              class="nav-link"
              onClick={() => {
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
      </aside>

      <div class="page-shell">
        <header class={`page-header ${headerCompact ? "compact-header" : ""}`}>
          <div>
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
          </div>

          <div class="header-right">
            <div class="filters-inline">
              {route.name === "list" ? (
                <>
                  <input
                    class="search-input"
                    value={query}
                    placeholder="Pretraži naslove i sastojke"
                    onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
                  />
                  <button
                    type="button"
                    class={`toggle-chip icon-toggle ${viewMode === "tiles" ? "active" : ""}`}
                    onClick={() => setViewMode("tiles")}
                    aria-label="Prikaz kartica"
                  >
                    ▦
                  </button>
                  <button
                    type="button"
                    class={`toggle-chip icon-toggle ${viewMode === "list" ? "active" : ""}`}
                    onClick={() => setViewMode("list")}
                    aria-label="Prikaz liste"
                  >
                    ☰
                  </button>
                </>
              ) : null}
            </div>

            <label class="language-picker" aria-label="Jezik aplikacije">
              <span>Jezik</span>
              <select
                value={language}
                onChange={(event) => setLanguage((event.currentTarget as HTMLSelectElement).value)}
              >
                {languages.map((item) => (
                  <option key={item.code} value={item.code}>{item.label}</option>
                ))}
              </select>
            </label>

            <div class="profile-area">
              <button
                type="button"
                class="profile-trigger"
                onClick={() => setProfileOpen((current) => !current)}
                aria-expanded={profileOpen}
              >
                <span class={`profile-avatar ${user?.avatar_url ? "has-image" : ""}`}>
                  {user?.avatar_url ? (
                    <img src={user.avatar_url} alt={user.display_name} />
                  ) : (
                    usernameFromUser(user).slice(0, 1).toUpperCase()
                  )}
                </span>
                <span class="profile-status">
                  <strong>{user ? `@${usernameFromUser(user)}` : "Gost"}</strong>
                  <span>{user ? "Prijavljen" : "Nije prijavljen"}</span>
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
                        <strong>@{usernameFromUser(user)}</strong>
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

        {appError ? <div class="alert error">{appError}</div> : null}
        {notice ? <div class="alert notice">{notice}</div> : null}

        {(route.name === "list" || route.name === "management") ? (
          <section class="content-grid">
            <div class="content-main">
              <div class="filter-bar panel">
                {route.name === "list" ? (
                  <div class="segmented-control" aria-label="Prikaz recepata">
                    {[
                      ["all", "Svi"],
                      ["mine", "Moji recepti"],
                      ["favorites", "Omiljeni"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        class={recipeScope === value ? "active" : ""}
                        disabled={value !== "all" && !user}
                        onClick={() => setRecipeScope(value as RecipeScope)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div class="segmented-control" aria-label="Upravljanje receptima">
                    <button
                      type="button"
                      class={managementMode === "unverified" ? "active" : ""}
                      onClick={() => setManagementMode("unverified")}
                    >
                      Neprovjereni recepti
                    </button>
                    <button
                      type="button"
                      class={managementMode === "latest" ? "active" : ""}
                      onClick={() => setManagementMode("latest")}
                    >
                      Zadnji recepti
                    </button>
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
                {route.name === "management" && isAdmin ? (
                  <span class="management-note">Korisnici i logovi dolaze ovdje za administratore.</span>
                ) : null}
              </div>

              <div class={viewMode === "tiles" ? "recipe-grid" : "recipe-list-rows"}>
                {recipes.map((recipe) => (
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
                        <p class="muted">@{recipe.author_username}</p>
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
                        : route.name === "management" && managementMode === "unverified"
                          ? "Nema neprovjerenih recepata."
                          : "Nema recepata za prikaz."}
                  </div>
                ) : null}
              </div>
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
                      <span>@{recipeDetail.author_username}</span>
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

                  <section class="story-block">
                    <h3>Priprema</h3>
                    <div
                      class="steps-html"
                      dangerouslySetInnerHTML={{
                        __html: renderRecipeMarkdown(
                          recipeDetail.content_markdown || recipeDetail.steps_html,
                        ),
                      }}
                    />
                  </section>
                </>
              ) : (
                <div class="empty-card">{loadingDetail ? "Učitavam recept..." : "Recept nije pronađen."}</div>
              )}
            </div>

            {recipeDetail ? (
              <aside class="detail-right">
                <div class="ingredients-panel panel">
                  <p class="eyebrow">Sastojci</p>
                  <div class="ingredients-stack">
                    {recipeDetail.ingredients.map((ingredient) => (
                      <div key={ingredient.id} class="ingredient-chip-row">
                        <strong>{ingredient.ingredient_name}</strong>
                        <span>
                          {ingredient.amount ?? "-"} {ingredient.unit ?? ""}
                        </span>
                        <span class="muted">{ingredient.note ?? ingredient.canonical_name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>
            ) : null}
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
                <button type="submit" class="primary" disabled={saving}>
                  {saving ? "Spremam..." : "SPREMI"}
                </button>
              </div>

              <p class="eyebrow">Editor</p>
              <h2>{route.name === "edit" ? "Uredi recept" : "Novi recept"}</h2>

              <div class="grid compact-editor-grid">
                <label>
                  Naslov
                  <input
                    required
                    value={formState.title}
                    onInput={(event) =>
                      setFormState({
                        ...formState,
                        title: (event.currentTarget as HTMLInputElement).value,
                      })
                    }
                  />
                </label>
                <label>
                  Kategorija
                  <select
                    required
                    value={formState.category_id}
                    onChange={(event) =>
                      setFormState({
                        ...formState,
                        category_id: (event.currentTarget as HTMLSelectElement).value,
                      })
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
                <label>
                  Porcije
                  <input
                    required
                    type="number"
                    min="1"
                    step="0.5"
                    value={formState.servings}
                    onInput={(event) =>
                      setFormState({
                        ...formState,
                        servings: (event.currentTarget as HTMLInputElement).value,
                      })
                    }
                  />
                </label>
                <label>
                  Vrijeme pripreme
                  <input
                    required
                    type="number"
                    min="1"
                    max="1440"
                    value={formState.prep_time_minutes}
                    onInput={(event) =>
                      setFormState({
                        ...formState,
                        prep_time_minutes: (event.currentTarget as HTMLInputElement).value,
                      })
                    }
                  />
                </label>
                <label>
                  Kompleksnost
                  <ComplexityPicker
                    value={formState.author_complexity}
                    onChange={(author_complexity) => setFormState({ ...formState, author_complexity })}
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

              <label>
                Postupak
                <RichTextEditor
                  value={formState.content_markdown}
                  token={token}
                  onChange={(content_markdown) => setFormState({ ...formState, content_markdown })}
                />
              </label>
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
