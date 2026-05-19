import { useEffect, useState } from "preact/hooks";

const apiBaseUrl =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8000/api"
    : "/api";
const tokenStorageKey = "letscook.accessToken";

type Role = "user" | "moderator" | "administrator" | "superadmin";

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

function heroImage(recipe: RecipeDetail | RecipeListItem | null): string | null {
  return recipe?.main_image_url ?? null;
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
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("durdica.vukelic@gmail.com");
  const [loginPassword, setLoginPassword] = useState("");
  const [formState, setFormState] = useState<RecipeFormState>(emptyRecipeForm());

  const isModerator =
    user?.role === "moderator" || user?.role === "administrator" || user?.role === "superadmin";

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
      setNotice(`Prijavljen si kao ${response.user.display_name}.`);
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  function handleLogout() {
    localStorage.removeItem(tokenStorageKey);
    setToken(null);
    setUser(null);
    setMineOnly(false);
    setIncludeHidden(false);
    setNotice("Odjavljen si.");
    navigate("/recipes");
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

  const listHeroRecipe = recipes[0] ?? null;

  return (
    <main class="shell">
      <header class="topbar">
        <button type="button" class="brand" onClick={() => navigate("/recipes")}>
          <span class="brand-mark">LC</span>
          <span>LetsCook</span>
        </button>

        <div class="topbar-actions">
          {user ? (
            <>
              <span class="role-pill">{user.display_name} · {user.role}</span>
              <button type="button" class="ghost" onClick={() => navigate("/recipes/new")}>
                Novi recept
              </button>
              <button type="button" class="secondary" onClick={handleLogout}>
                Sign out
              </button>
            </>
          ) : null}
        </div>
      </header>

      {appError ? <div class="alert error">{appError}</div> : null}
      {notice ? <div class="alert notice">{notice}</div> : null}

      {!user ? (
        <section class="login-banner panel">
          <div>
            <p class="eyebrow">Prijava</p>
            <h1>Prijavi se i nastavi uređivati recepte.</h1>
            <p class="muted">Recepti su sada otvarivi preko URL-a i pregledniji na zasebnoj recipe stranici.</p>
          </div>
          <form class="login-form" onSubmit={handleLogin}>
            <label>
              Email
              <input value={loginEmail} onInput={(event) => setLoginEmail((event.currentTarget as HTMLInputElement).value)} />
            </label>
            <label>
              Password
              <input type="password" value={loginPassword} onInput={(event) => setLoginPassword((event.currentTarget as HTMLInputElement).value)} />
            </label>
            <button type="submit" class="primary">Sign in</button>
          </form>
        </section>
      ) : null}

      {route.name === "list" ? (
        <section class="list-layout">
          <aside class="filters panel">
            <p class="eyebrow">Pretraga</p>
            <h2>Pronađi recept za dijeljenje ili uređivanje.</h2>
            <label>
              Naslov ili sastojak
              <input value={query} onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)} />
            </label>
            <label class="checkbox-row">
              <input type="checkbox" checked={mineOnly} disabled={!user} onChange={(event) => setMineOnly((event.currentTarget as HTMLInputElement).checked)} />
              <span>Samo moji recepti</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" checked={includeHidden} disabled={!isModerator} onChange={(event) => setIncludeHidden((event.currentTarget as HTMLInputElement).checked)} />
              <span>Prikaži skrivene</span>
            </label>
            <p class="muted small">URL svakog recepta je shareable preko `#/recipes/&lt;id&gt;`.</p>
          </aside>

          <section class="list-content">
            <article class="hero-card panel">
              <div>
                <p class="eyebrow">Kolekcija recepata</p>
                <h1>{listHeroRecipe?.title ?? "Recepti"}</h1>
                <p class="muted">{listHeroRecipe ? `${listHeroRecipe.author_name} · ${listHeroRecipe.category_name ?? "Bez kategorije"}` : "Odaberi recept iz liste ispod."}</p>
              </div>
              {heroImage(listHeroRecipe) ? <img class="hero-image" src={heroImage(listHeroRecipe)!} alt={listHeroRecipe?.title ?? "Recipe"} /> : null}
            </article>

            <div class="recipe-grid">
              {recipes.map((recipe) => (
                <article key={recipe.id} class="recipe-tile panel">
                  <button type="button" class="tile-link" onClick={() => navigate(`/recipes/${recipe.id}`)}>
                    {recipe.main_image_url ? <img class="tile-image" src={recipe.main_image_url} alt={recipe.title} /> : <div class="tile-placeholder">{recipe.title.slice(0, 2)}</div>}
                    <div class="tile-body">
                      <div class="tile-meta">
                        <span>{recipe.category_name ?? "Bez kategorije"}</span>
                        {recipe.hidden ? <span class="status-tag">hidden</span> : null}
                      </div>
                      <h3>{recipe.title}</h3>
                      <p>{recipe.author_name}</p>
                      <p class="muted">{recipe.servings} porcija · kompleksnost {recipe.author_complexity}/5</p>
                    </div>
                  </button>
                </article>
              ))}
              {!recipes.length && !loadingRecipes ? <div class="panel empty-card">Nema recepata za prikaz.</div> : null}
            </div>
          </section>
        </section>
      ) : null}

      {route.name === "detail" ? (
        <section class="detail-layout">
          <div class="detail-main">
            <div class="detail-toolbar">
              <button type="button" class="ghost" onClick={() => navigate("/recipes")}>
                Natrag na listu
              </button>
              <div class="action-row compact">
                {recipeDetail?.can_edit ? <button type="button" class="secondary" onClick={() => navigate(`/recipes/${recipeDetail.id}/edit`)}>Uredi</button> : null}
                {recipeDetail?.can_hide ? <button type="button" class="secondary" onClick={() => updateVisibility({ hidden: !recipeDetail.hidden })}>{recipeDetail.hidden ? "Prikaži" : "Sakrij"}</button> : null}
                {recipeDetail?.can_delete ? <button type="button" class="ghost danger" onClick={() => updateVisibility({ deleted: !recipeDetail.deleted })}>{recipeDetail.deleted ? "Vrati" : "Označi obrisanim"}</button> : null}
              </div>
            </div>

            {recipeDetail ? (
              <article class="recipe-page panel">
                <p class="eyebrow">Recipe URL</p>
                <h1>{recipeDetail.title}</h1>
                <div class="meta-strip">
                  <span>{recipeDetail.author_name}</span>
                  <span>{recipeDetail.category_name ?? "Bez kategorije"}</span>
                  <span>{recipeDetail.servings} porcija</span>
                  <span>Kompleksnost {recipeDetail.author_complexity}/5</span>
                </div>

                {recipeDetail.media.length ? (
                  <section class="media-gallery">
                    {recipeDetail.media.map((media) => (
                      <img key={media.id} src={media.url} alt={recipeDetail.title} class="gallery-image" />
                    ))}
                  </section>
                ) : null}

                <div class="recipe-columns">
                  <div class="recipe-story">
                    <section class="story-block">
                      <h2>Postupak</h2>
                      <ol class="steps-list">
                        {recipeDetail.steps.map((step, index) => (
                          <li key={`${recipeDetail.id}-${index}`}>{step}</li>
                        ))}
                      </ol>
                    </section>

                    <section class="story-block notes-block">
                      <h2>Meta</h2>
                      <p>Objavljeno: {formatDate(recipeDetail.created_at)}</p>
                      <p>Ažurirano: {formatDate(recipeDetail.updated_at)}</p>
                    </section>
                  </div>

                  <aside class="ingredients-rail panel">
                    <p class="eyebrow">Sastojci</p>
                    <div class="ingredients-stack">
                      {recipeDetail.ingredients.map((ingredient) => (
                        <div key={ingredient.id} class="ingredient-chip-row">
                          <strong>{ingredient.ingredient_name}</strong>
                          <span>{ingredient.amount ?? "-"} {ingredient.unit ?? ""}</span>
                          <span class="muted">{ingredient.note ?? ingredient.canonical_name}</span>
                        </div>
                      ))}
                    </div>
                  </aside>
                </div>
              </article>
            ) : (
              <div class="panel empty-card">{loadingDetail ? "Učitavam recept..." : "Recept nije pronađen."}</div>
            )}
          </div>
        </section>
      ) : null}

      {(route.name === "new" || route.name === "edit") ? (
        <section class="editor-layout">
          <form class="panel editor-page" onSubmit={saveRecipe}>
            <div class="detail-toolbar">
              <button type="button" class="ghost" onClick={() => navigate(route.name === "edit" && recipeDetail ? `/recipes/${recipeDetail.id}` : "/recipes")}>
                Natrag
              </button>
              <button type="submit" class="primary" disabled={saving}>{saving ? "Spremam..." : route.name === "edit" ? "Spremi izmjene" : "Kreiraj recept"}</button>
            </div>

            <p class="eyebrow">Editor</p>
            <h1>{route.name === "edit" ? "Uredi recept" : "Novi recept"}</h1>

            <div class="grid two-columns">
              <label>
                Naslov
                <input value={formState.title} onInput={(event) => setFormState({ ...formState, title: (event.currentTarget as HTMLInputElement).value })} />
              </label>
              <label>
                Kategorija
                <select value={formState.category_id} onChange={(event) => setFormState({ ...formState, category_id: (event.currentTarget as HTMLSelectElement).value })}>
                  <option value="">Bez kategorije</option>
                  {options.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
              <label>
                Jezik
                <select value={formState.language} onChange={(event) => setFormState({ ...formState, language: (event.currentTarget as HTMLSelectElement).value })}>
                  <option value="hr">Hrvatski</option>
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                </select>
              </label>
              <label>
                Porcije
                <input type="number" min="1" step="0.5" value={formState.servings} onInput={(event) => setFormState({ ...formState, servings: (event.currentTarget as HTMLInputElement).value })} />
              </label>
              <label>
                Kompleksnost
                <input type="number" min="1" max="5" value={formState.author_complexity} onInput={(event) => setFormState({ ...formState, author_complexity: (event.currentTarget as HTMLInputElement).value })} />
              </label>
            </div>

            <label>
              Postupak
              <textarea rows={12} value={formState.steps_html} onInput={(event) => setFormState({ ...formState, steps_html: (event.currentTarget as HTMLTextAreaElement).value })} />
            </label>

            <div class="editor-ingredients panel">
              <div class="panel-header">
                <h2>Sastojci</h2>
                <button type="button" class="ghost" onClick={addIngredientRow}>Dodaj red</button>
              </div>
              <div class="editor-ingredient-table">
                {formState.ingredients.map((ingredient, index) => (
                  <div key={`${index}-${ingredient.ingredient_id}`} class="ingredient-editor-row">
                    <select value={ingredient.ingredient_id} onChange={(event) => updateIngredientRow(index, { ingredient_id: Number((event.currentTarget as HTMLSelectElement).value) })}>
                      <option value="0">Odaberi sastojak</option>
                      {options.ingredients.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                    <input placeholder="Količina" value={ingredient.amount} onInput={(event) => updateIngredientRow(index, { amount: (event.currentTarget as HTMLInputElement).value })} />
                    <input placeholder="Jedinica" value={ingredient.unit} onInput={(event) => updateIngredientRow(index, { unit: (event.currentTarget as HTMLInputElement).value })} />
                    <input placeholder="Napomena" value={ingredient.note} onInput={(event) => updateIngredientRow(index, { note: (event.currentTarget as HTMLInputElement).value })} />
                    <button type="button" class="ghost danger" onClick={() => removeIngredientRow(index)}>Makni</button>
                  </div>
                ))}
              </div>
            </div>
          </form>
        </section>
      ) : null}
    </main>
  );
}
