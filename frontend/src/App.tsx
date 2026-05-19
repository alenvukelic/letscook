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
  author_id: number;
  ingredients: RecipeIngredient[];
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

export function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem(tokenStorageKey));
  const [user, setUser] = useState<User | null>(null);
  const [options, setOptions] = useState<RecipeFormOptions>({ categories: [], ingredients: [] });
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeDetail | null>(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [editorMode, setEditorMode] = useState<"closed" | "create" | "edit">("closed");
  const [formState, setFormState] = useState<RecipeFormState>(emptyRecipeForm());
  const [saving, setSaving] = useState(false);

  const isModerator = user?.role === "moderator" || user?.role === "administrator" || user?.role === "superadmin";

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
    if (selectedRecipeId == null) {
      setSelectedRecipe(null);
      return;
    }

    void loadRecipeDetail(selectedRecipeId);
  }, [selectedRecipeId, token]);

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

      if (selectedRecipeId && !list.some((recipe) => recipe.id === selectedRecipeId)) {
        setSelectedRecipeId(list[0]?.id ?? null);
      }
      if (!selectedRecipeId && list[0]) {
        setSelectedRecipeId(list[0].id);
      }
    } catch (error) {
      setAppError((error as Error).message);
    } finally {
      setLoadingRecipes(false);
    }
  }

  async function loadRecipeDetail(recipeId: number) {
    setLoadingDetail(true);
    try {
      const detail = await apiRequest<RecipeDetail>(`/recipes/${recipeId}?language=hr`, {}, token);
      setSelectedRecipe(detail);
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
    setEditorMode("closed");
    setNotice("Odjavljen si.");
  }

  function startCreateRecipe() {
    setEditorMode("create");
    setFormState(emptyRecipeForm());
    setNotice(null);
  }

  function startEditRecipe() {
    if (!selectedRecipe) {
      return;
    }

    setEditorMode("edit");
    setFormState(formFromRecipe(selectedRecipe));
    setNotice(null);
  }

  function closeEditor() {
    setEditorMode("closed");
    setFormState(emptyRecipeForm());
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
      const path =
        editorMode === "edit" && selectedRecipe
          ? `/recipes/${selectedRecipe.id}`
          : "/recipes";
      const method = editorMode === "edit" ? "PUT" : "POST";
      const saved = await apiRequest<RecipeDetail>(
        path,
        { method, body: JSON.stringify(payload) },
        token,
      );
      setSelectedRecipeId(saved.id);
      setSelectedRecipe(saved);
      setEditorMode("closed");
      setNotice(editorMode === "edit" ? "Recept je ažuriran." : "Recept je kreiran.");
      await loadRecipes();
    } catch (error) {
      setAppError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function updateVisibility(patch: { hidden?: boolean; deleted?: boolean }) {
    if (!selectedRecipe || !token) {
      return;
    }

    try {
      const updated = await apiRequest<RecipeDetail>(
        `/recipes/${selectedRecipe.id}/visibility`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        },
        token,
      );
      setSelectedRecipe(updated);
      setNotice("Status recepta je promijenjen.");
      await loadRecipes();
    } catch (error) {
      setAppError((error as Error).message);
    }
  }

  return (
    <main class="app-shell">
      <section class="sidebar">
        <div class="panel brand-panel">
          <p class="eyebrow">LetsCook</p>
          <h1>Recepti, prijava i uređivanje su sada spojeni na API.</h1>
          <p class="muted">
            Prijava koristi postojeće korisnike iz baze. Korisnici uređuju svoje recepte, moderatori
            skrivaju, a administratori i superadmin mogu i označiti recept kao obrisan.
          </p>
        </div>

        <div class="panel auth-panel">
          <div class="panel-header">
            <h2>Sign in</h2>
            {user ? <span class="role-pill">{user.role}</span> : null}
          </div>

          {user ? (
            <div class="stack gap-sm">
              <p>
                <strong>{user.display_name}</strong>
                <br />
                <span class="muted">{user.email}</span>
              </p>
              <button type="button" class="secondary" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          ) : (
            <form class="stack gap-sm" onSubmit={handleLogin}>
              <label>
                Email
                <input value={loginEmail} onInput={(event) => setLoginEmail((event.currentTarget as HTMLInputElement).value)} />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={loginPassword}
                  onInput={(event) => setLoginPassword((event.currentTarget as HTMLInputElement).value)}
                />
              </label>
              <button type="submit" class="primary">
                Sign in
              </button>
            </form>
          )}
        </div>

        <div class="panel">
          <div class="panel-header">
            <h2>Pretraga</h2>
            {loadingRecipes ? <span class="muted">Ucitavanje...</span> : null}
          </div>
          <div class="stack gap-sm">
            <label>
              Naziv ili sastojak
              <input value={query} onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)} />
            </label>
            <label class="checkbox-row">
              <input
                type="checkbox"
                checked={mineOnly}
                disabled={!user}
                onChange={(event) => setMineOnly((event.currentTarget as HTMLInputElement).checked)}
              />
              <span>Samo moji recepti</span>
            </label>
            <label class="checkbox-row">
              <input
                type="checkbox"
                checked={includeHidden}
                disabled={!isModerator}
                onChange={(event) => setIncludeHidden((event.currentTarget as HTMLInputElement).checked)}
              />
              <span>Prikaži skrivene</span>
            </label>
            {user ? (
              <button type="button" class="primary" onClick={startCreateRecipe}>
                Novi recept
              </button>
            ) : null}
          </div>
        </div>

        <div class="panel recipe-list-panel">
          <div class="panel-header">
            <h2>Recepti</h2>
            <span class="count-pill">{recipes.length}</span>
          </div>
          <div class="recipe-list">
            {recipes.map((recipe) => (
              <button
                key={recipe.id}
                type="button"
                class={`recipe-card ${selectedRecipeId === recipe.id ? "selected" : ""}`}
                onClick={() => setSelectedRecipeId(recipe.id)}
              >
                <div class="recipe-card-header">
                  <strong>{recipe.title}</strong>
                  {recipe.hidden ? <span class="status-tag">hidden</span> : null}
                </div>
                <span class="muted">{recipe.author_name}</span>
                <span class="muted">{recipe.category_name ?? "Bez kategorije"}</span>
              </button>
            ))}
            {!recipes.length && !loadingRecipes ? <p class="muted">Nema recepata za prikaz.</p> : null}
          </div>
        </div>
      </section>

      <section class="content">
        {appError ? <div class="alert error">{appError}</div> : null}
        {notice ? <div class="alert notice">{notice}</div> : null}

        {editorMode !== "closed" ? (
          <form class="panel editor-panel stack gap-md" onSubmit={saveRecipe}>
            <div class="panel-header">
              <h2>{editorMode === "edit" ? "Uredi recept" : "Novi recept"}</h2>
              <button type="button" class="ghost" onClick={closeEditor}>
                Zatvori
              </button>
            </div>

            <div class="grid two-columns">
              <label>
                Naslov
                <input value={formState.title} onInput={(event) => setFormState({ ...formState, title: (event.currentTarget as HTMLInputElement).value })} />
              </label>
              <label>
                Kategorija
                <select value={formState.category_id} onChange={(event) => setFormState({ ...formState, category_id: (event.currentTarget as HTMLSelectElement).value })}>
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
                <select value={formState.language} onChange={(event) => setFormState({ ...formState, language: (event.currentTarget as HTMLSelectElement).value })}>
                  <option value="hr">Hrvatski</option>
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                </select>
              </label>
              <label>
                Servings
                <input type="number" min="1" step="0.5" value={formState.servings} onInput={(event) => setFormState({ ...formState, servings: (event.currentTarget as HTMLInputElement).value })} />
              </label>
              <label>
                Complexity
                <input type="number" min="1" max="5" value={formState.author_complexity} onInput={(event) => setFormState({ ...formState, author_complexity: (event.currentTarget as HTMLInputElement).value })} />
              </label>
            </div>

            <label>
              Koraci
              <textarea rows={10} value={formState.steps_html} onInput={(event) => setFormState({ ...formState, steps_html: (event.currentTarget as HTMLTextAreaElement).value })} />
            </label>

            <div class="stack gap-sm">
              <div class="panel-header">
                <h3>Sastojci</h3>
                <button type="button" class="ghost" onClick={addIngredientRow}>
                  Dodaj red
                </button>
              </div>

              {formState.ingredients.map((ingredient, index) => (
                <div key={`${index}-${ingredient.ingredient_id}`} class="ingredient-editor-row">
                  <select value={ingredient.ingredient_id} onChange={(event) => updateIngredientRow(index, { ingredient_id: Number((event.currentTarget as HTMLSelectElement).value) })}>
                    <option value="0">Odaberi sastojak</option>
                    {options.ingredients.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <input placeholder="Količina" value={ingredient.amount} onInput={(event) => updateIngredientRow(index, { amount: (event.currentTarget as HTMLInputElement).value })} />
                  <input placeholder="Jedinica" value={ingredient.unit} onInput={(event) => updateIngredientRow(index, { unit: (event.currentTarget as HTMLInputElement).value })} />
                  <input placeholder="Napomena" value={ingredient.note} onInput={(event) => updateIngredientRow(index, { note: (event.currentTarget as HTMLInputElement).value })} />
                  <button type="button" class="ghost danger" onClick={() => removeIngredientRow(index)}>
                    Makni
                  </button>
                </div>
              ))}
            </div>

            <div class="action-row">
              <button type="submit" class="primary" disabled={saving}>
                {saving ? "Spremam..." : editorMode === "edit" ? "Spremi izmjene" : "Kreiraj recept"}
              </button>
              <button type="button" class="secondary" onClick={closeEditor}>
                Odustani
              </button>
            </div>
          </form>
        ) : null}

        {selectedRecipe ? (
          <article class="panel detail-panel stack gap-md">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Detalj recepta</p>
                <h2>{selectedRecipe.title}</h2>
              </div>
              <div class="action-row compact">
                {selectedRecipe.can_edit ? (
                  <button type="button" class="secondary" onClick={startEditRecipe}>
                    Uredi
                  </button>
                ) : null}
                {selectedRecipe.can_hide ? (
                  <button
                    type="button"
                    class="secondary"
                    onClick={() => updateVisibility({ hidden: !selectedRecipe.hidden })}
                  >
                    {selectedRecipe.hidden ? "Prikaži" : "Sakrij"}
                  </button>
                ) : null}
                {selectedRecipe.can_delete ? (
                  <button type="button" class="ghost danger" onClick={() => updateVisibility({ deleted: !selectedRecipe.deleted })}>
                    {selectedRecipe.deleted ? "Vrati" : "Označi obrisanim"}
                  </button>
                ) : null}
              </div>
            </div>

            <div class="meta-grid">
              <div>
                <strong>Autor</strong>
                <p>{selectedRecipe.author_name}</p>
              </div>
              <div>
                <strong>Kategorija</strong>
                <p>{selectedRecipe.category_name ?? "Bez kategorije"}</p>
              </div>
              <div>
                <strong>Servings</strong>
                <p>{selectedRecipe.servings}</p>
              </div>
              <div>
                <strong>Complexity</strong>
                <p>{selectedRecipe.author_complexity}/5</p>
              </div>
              <div>
                <strong>Kreirano</strong>
                <p>{formatDate(selectedRecipe.created_at)}</p>
              </div>
              <div>
                <strong>Ažurirano</strong>
                <p>{formatDate(selectedRecipe.updated_at)}</p>
              </div>
            </div>

            <section>
              <h3>Sastojci</h3>
              <div class="ingredient-list">
                {selectedRecipe.ingredients.map((ingredient) => (
                  <div key={ingredient.id} class="ingredient-row">
                    <strong>{ingredient.ingredient_name}</strong>
                    <span>
                      {ingredient.amount ?? "-"} {ingredient.unit ?? ""}
                    </span>
                    <span class="muted">{ingredient.note ?? ingredient.canonical_name}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3>Koraci</h3>
              <div class="steps-box" dangerouslySetInnerHTML={{ __html: selectedRecipe.steps_html }} />
            </section>
          </article>
        ) : (
          <div class="panel empty-panel">
            {loadingDetail ? <p>Učitavam detalj recepta...</p> : <p>Odaberi recept s lijeve strane.</p>}
          </div>
        )}
      </section>
    </main>
  );
}
