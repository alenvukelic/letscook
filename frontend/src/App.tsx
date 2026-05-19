import { useEffect, useState } from "preact/hooks";

const apiBaseUrl =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8000/api"
    : "/api";
const tokenStorageKey = "letscook.accessToken";

type Role = "user" | "moderator" | "administrator" | "superadmin";
type ViewMode = "tiles" | "list";
type AuthPanelMode = "login" | "register";

type User = {
  id: number;
  email: string;
  display_name: string;
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
  author_complexity: number;
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
  steps_html: string;
  steps: string[];
  author_id: number;
  ingredients: RecipeIngredient[];
  media: RecipeMedia[];
};

type RecipeFormOptions = {
  categories: CategoryOption[];
  ingredients: IngredientOption[];
};

type RecipeFormIngredient = {
  ingredient_id: number;
  amount: string;
  unit: string;
  note: string;
};

type RecipeFormState = {
  title: string;
  category_id: string;
  language: string;
  steps_html: string;
  servings: string;
  author_complexity: string;
  ingredients: RecipeFormIngredient[];
};

type Route =
  | { name: "list" }
  | { name: "detail"; recipeId: number }
  | { name: "new" }
  | { name: "edit"; recipeId: number };

const emptyIngredientRow = (): RecipeFormIngredient => ({
  ingredient_id: 0,
  amount: "",
  unit: "",
  note: "",
});

const emptyRecipeForm = (): RecipeFormState => ({
  title: "",
  category_id: "",
  language: "hr",
  steps_html: "",
  servings: "4",
  author_complexity: "3",
  ingredients: [emptyIngredientRow()],
});

const navItems = [
  { label: "Recepti", icon: "R", path: "/recipes" },
  { label: "Novi recept", icon: "+", path: "/recipes/new" },
  { label: "Omiljeni", icon: "O", action: "favorites" },
  { label: "Moji recepti", icon: "M", action: "mine" },
];

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#/, "") || "/recipes";
  const parts = hash.split("/").filter(Boolean);

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
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

function formFromRecipe(recipe: RecipeDetail): RecipeFormState {
  return {
    title: recipe.title,
    category_id: recipe.category_id ? String(recipe.category_id) : "",
    language: recipe.language,
    steps_html: recipe.steps_html,
    servings: String(recipe.servings),
    author_complexity: String(recipe.author_complexity),
    ingredients: recipe.ingredients.length
      ? recipe.ingredients.map((ingredient) => ({
          ingredient_id: ingredient.ingredient_id,
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

export function App() {
  const [route, setRoute] = useState<Route>(parseRoute());
  const [token, setToken] = useState<string | null>(localStorage.getItem(tokenStorageKey));
  const [user, setUser] = useState<User | null>(null);
  const [options, setOptions] = useState<RecipeFormOptions>({ categories: [], ingredients: [] });
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [recipeDetail, setRecipeDetail] = useState<RecipeDetail | null>(null);
  const [query, setQuery] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("tiles");
  const [profileOpen, setProfileOpen] = useState(false);
  const [authPanelMode, setAuthPanelMode] = useState<AuthPanelMode>("login");
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("durdica.vukelic@gmail.com");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerDisplayName, setRegisterDisplayName] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [formState, setFormState] = useState<RecipeFormState>(emptyRecipeForm());

  const isModerator =
    user?.role === "moderator" || user?.role === "administrator" || user?.role === "superadmin";
  const collapsedNav = route.name === "detail";

  useEffect(() => {
    const syncRoute = () => setRoute(parseRoute());
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    if (!window.location.hash) {
      navigate("/recipes");
    }
  }, []);

  useEffect(() => {
    void apiRequest<RecipeFormOptions>("/recipes/options?language=hr")
      .then(setOptions)
      .catch((error: Error) => setAppError(error.message));
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      localStorage.removeItem(tokenStorageKey);
      return;
    }

    localStorage.setItem(tokenStorageKey, token);
    void apiRequest<User>("/auth/me", {}, token)
      .then(setUser)
      .catch(() => {
        localStorage.removeItem(tokenStorageKey);
        setToken(null);
        setUser(null);
        setNotice("Sesija je istekla. Prijavi se ponovno.");
      });
  }, [token]);

  useEffect(() => {
    void loadRecipes();
  }, [token, query, mineOnly, includeHidden]);

  useEffect(() => {
    if (route.name === "detail" || route.name === "edit") {
      void loadRecipeDetail(route.recipeId);
      return;
    }
    setRecipeDetail(null);
    if (route.name === "new") {
      setFormState(emptyRecipeForm());
    }
  }, [route, token]);

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
    if (mineOnly) {
      params.set("mine", "true");
    }
    if (includeHidden) {
      params.set("include_hidden", "true");
    }

    try {
      const list = await apiRequest<RecipeListItem[]>(`/recipes?${params.toString()}`, {}, token);
      setRecipes(list);
    } catch (error) {
      setAppError((error as Error).message);
    } finally {
      setLoadingRecipes(false);
    }
  }

  async function loadRecipeDetail(recipeId: number) {
    setLoadingDetail(true);
    setAppError(null);
    try {
      const detail = await apiRequest<RecipeDetail>(`/recipes/${recipeId}?language=hr`, {}, token);
      setRecipeDetail(detail);
    } catch (error) {
      setAppError((error as Error).message);
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
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      setToken(response.access_token);
      setUser(response.user);
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
    localStorage.removeItem(tokenStorageKey);
    setToken(null);
    setUser(null);
    setProfileOpen(false);
    setMineOnly(false);
    setIncludeHidden(false);
    setNotice("Odjavljen si.");
    navigate("/recipes");
  }

  function handleUserMenu(action: string) {
    setProfileOpen(false);
    if (action === "mine") {
      setMineOnly(true);
      navigate("/recipes");
      return;
    }
    if (action === "favorites") {
      setNotice("Omiljeni recepti dolaze u idućem koraku.");
      navigate("/recipes");
      return;
    }
    if (action === "profile") {
      setNotice("Uređivanje profila i promjena lozinke dolaze u idućem koraku.");
      return;
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
    if (!token) {
      setAppError("Prijava je obavezna za spremanje recepta.");
      return;
    }

    setSaving(true);
    setAppError(null);

    const payload = {
      title: formState.title,
      category_id: formState.category_id ? Number(formState.category_id) : null,
      language: formState.language,
      steps_html: formState.steps_html,
      servings: Number(formState.servings),
      author_complexity: Number(formState.author_complexity),
      ingredients: formState.ingredients
        .filter((ingredient) => ingredient.ingredient_id > 0)
        .map((ingredient) => ({
          ingredient_id: ingredient.ingredient_id,
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
      setAppError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function updateVisibility(patch: { hidden?: boolean; deleted?: boolean }) {
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

  return (
    <main class="app-shell">
      <aside class={`left-rail ${collapsedNav ? "collapsed" : ""}`}>
        <button type="button" class="brand-block" onClick={() => navigate("/recipes")}>
          <span class="brand-mark">LC</span>
          <span class="brand-text">LetsCook</span>
        </button>

        <nav class="main-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.label}
              type="button"
              class="nav-link"
              onClick={() => {
                if (item.path) {
                  navigate(item.path);
                  return;
                }
                handleUserMenu(item.action!);
              }}
            >
              <span class="nav-icon">{item.icon}</span>
              <span class="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div class="page-shell">
        <header class="page-header">
          <div>
            <p class="eyebrow">LetsCook</p>
            <h1 class="page-title">
              {route.name === "detail"
                ? recipeDetail?.title ?? "Recept"
                : route.name === "edit"
                  ? "Uredi recept"
                  : route.name === "new"
                    ? "Dodaj novi recept"
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
                    class={`toggle-chip ${viewMode === "tiles" ? "active" : ""}`}
                    onClick={() => setViewMode("tiles")}
                  >
                    Tile
                  </button>
                  <button
                    type="button"
                    class={`toggle-chip ${viewMode === "list" ? "active" : ""}`}
                    onClick={() => setViewMode("list")}
                  >
                    Lista
                  </button>
                </>
              ) : null}
            </div>

            <div class="profile-area">
              <button
                type="button"
                class="profile-trigger"
                onClick={() => setProfileOpen((current) => !current)}
                aria-expanded={profileOpen}
              >
                <span class="profile-avatar">{usernameFromUser(user).slice(0, 1).toUpperCase()}</span>
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
                          <button type="submit" class="primary">
                            Sign in
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
                      <button type="button" class="menu-link" onClick={() => handleUserMenu("profile")}>Promjena lozinke</button>
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

        {route.name === "list" ? (
          <section class="content-grid">
            <div class="content-main">
              <div class="filter-bar panel">
                <label class="inline-check">
                  <input
                    type="checkbox"
                    checked={mineOnly}
                    disabled={!user}
                    onChange={(event) => setMineOnly((event.currentTarget as HTMLInputElement).checked)}
                  />
                  <span>Samo moji recepti</span>
                </label>
                <label class="inline-check">
                  <input
                    type="checkbox"
                    checked={includeHidden}
                    disabled={!isModerator}
                    onChange={(event) =>
                      setIncludeHidden((event.currentTarget as HTMLInputElement).checked)
                    }
                  />
                  <span>Prikaži skrivene</span>
                </label>
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
                        </div>
                        <h3>{recipe.title}</h3>
                        <p class="muted">@{recipe.author_username}</p>
                        <p class="muted">
                          {recipe.servings} porcija · kompleksnost {recipe.author_complexity}/5
                        </p>
                      </div>
                    </button>
                  </article>
                ))}
                {!recipes.length && !loadingRecipes ? (
                  <div class="panel empty-card">Nema recepata za prikaz.</div>
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
                      <span>{recipeDetail.servings} porcija</span>
                      <span>Kompleksnost {recipeDetail.author_complexity}/5</span>
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
                    <ol class="steps-list">
                      {recipeDetail.steps.map((step, index) => (
                        <li key={`${recipeDetail.id}-${index}`}>{step}</li>
                      ))}
                    </ol>
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
                  {saving ? "Spremam..." : route.name === "edit" ? "Spremi izmjene" : "Kreiraj recept"}
                </button>
              </div>

              <p class="eyebrow">Editor</p>
              <h2>{route.name === "edit" ? "Uredi recept" : "Novi recept"}</h2>

              <div class="grid two-columns">
                <label>
                  Naslov
                  <input
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
                    value={formState.category_id}
                    onChange={(event) =>
                      setFormState({
                        ...formState,
                        category_id: (event.currentTarget as HTMLSelectElement).value,
                      })
                    }
                  >
                    <option value="">Bez kategorije</option>
                    {options.categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Jezik
                  <select
                    value={formState.language}
                    onChange={(event) =>
                      setFormState({
                        ...formState,
                        language: (event.currentTarget as HTMLSelectElement).value,
                      })
                    }
                  >
                    <option value="hr">Hrvatski</option>
                    <option value="en">English</option>
                    <option value="de">Deutsch</option>
                  </select>
                </label>
                <label>
                  Porcije
                  <input
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
                  Kompleksnost
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={formState.author_complexity}
                    onInput={(event) =>
                      setFormState({
                        ...formState,
                        author_complexity: (event.currentTarget as HTMLInputElement).value,
                      })
                    }
                  />
                </label>
              </div>

              <label>
                Postupak
                <textarea
                  rows={12}
                  value={formState.steps_html}
                  onInput={(event) =>
                    setFormState({
                      ...formState,
                      steps_html: (event.currentTarget as HTMLTextAreaElement).value,
                    })
                  }
                />
              </label>

              <div class="editor-ingredients panel">
                <div class="section-head">
                  <h3>Sastojci</h3>
                  <button type="button" class="ghost" onClick={addIngredientRow}>
                    Dodaj red
                  </button>
                </div>
                <div class="editor-ingredient-table">
                  {formState.ingredients.map((ingredient, index) => (
                    <div key={`${index}-${ingredient.ingredient_id}`} class="ingredient-editor-row">
                      <select
                        value={ingredient.ingredient_id}
                        onChange={(event) =>
                          updateIngredientRow(index, {
                            ingredient_id: Number((event.currentTarget as HTMLSelectElement).value),
                          })
                        }
                      >
                        <option value="0">Odaberi sastojak</option>
                        {options.ingredients.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                      <input
                        placeholder="Količina"
                        value={ingredient.amount}
                        onInput={(event) =>
                          updateIngredientRow(index, {
                            amount: (event.currentTarget as HTMLInputElement).value,
                          })
                        }
                      />
                      <input
                        placeholder="Jedinica"
                        value={ingredient.unit}
                        onInput={(event) =>
                          updateIngredientRow(index, {
                            unit: (event.currentTarget as HTMLInputElement).value,
                          })
                        }
                      />
                      <input
                        placeholder="Napomena"
                        value={ingredient.note}
                        onInput={(event) =>
                          updateIngredientRow(index, {
                            note: (event.currentTarget as HTMLInputElement).value,
                          })
                        }
                      />
                      <button type="button" class="ghost danger-link" onClick={() => removeIngredientRow(index)}>
                        Makni
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </form>
          </section>
        ) : null}
      </div>
    </main>
  );
}
