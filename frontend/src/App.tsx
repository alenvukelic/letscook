const languages = ["Croatian", "English", "German"];

const highlights = [
  {
    title: "Cook from what you have",
    text: "Search by ingredients first, then refine by category, language, complexity, ratings, or favorites.",
  },
  {
    title: "Structured recipes",
    text: "Titles, tags, servings, canonical ingredients, rich steps, images, ratings, and community complexity stay queryable.",
  },
  {
    title: "Clean community",
    text: "Moderators hide bad entries, administrators review hidden content, and every action is traceable.",
  },
];

const recipeCards = [
  { name: "Lemon herb chicken", meta: "45 min | medium | 4 servings", tag: "Dinner" },
  { name: "Bakina juha", meta: "60 min | easy | 6 servings", tag: "Comfort" },
  { name: "Apple strudel", meta: "90 min | focused | 8 servings", tag: "Dessert" },
];

export function App() {
  return (
    <main class="shell">
      <nav class="topbar" aria-label="Main navigation">
        <a class="brand" href="/" aria-label="LetsCook home">
          <span class="brand-mark">LC</span>
          <span>LetsCook</span>
        </a>
        <div class="nav-actions">
          <a href="#features">Features</a>
          <a href="#recipes">Recipes</a>
          <button type="button">Sign in</button>
        </div>
      </nav>

      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Multilingual community cookbook</p>
          <h1>Find the recipe that fits your pantry, language, and skill level.</h1>
          <p class="hero-text">
            LetsCook is being built for practical recipe sharing: structured ingredients,
            simple search, clean moderation, and a calm editor that keeps cooking details easy
            to reuse.
          </p>
          <div class="hero-actions">
            <button type="button" class="primary">Browse recipes</button>
            <button type="button" class="secondary">Add recipe</button>
          </div>
          <div class="language-row" aria-label="Initial languages">
            {languages.map((language) => (
              <span key={language}>{language}</span>
            ))}
          </div>
        </div>

        <aside class="search-card" aria-label="Recipe search preview">
          <div class="card-header">
            <span>Smart search</span>
            <strong>3 matches</strong>
          </div>
          <label>
            Ingredients
            <input value="eggs, flour, apples" readOnly />
          </label>
          <div class="filter-grid">
            <span>German</span>
            <span>Dessert</span>
            <span>Medium</span>
            <span>Favorites</span>
          </div>
          <div class="match-list">
            {recipeCards.map((recipe) => (
              <article key={recipe.name}>
                <span>{recipe.tag}</span>
                <h3>{recipe.name}</h3>
                <p>{recipe.meta}</p>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section class="section" id="features">
        <div class="section-heading">
          <p class="eyebrow">MVP direction</p>
          <h2>Designed around useful recipe data, not just pages of text.</h2>
        </div>
        <div class="feature-grid">
          {highlights.map((item) => (
            <article class="feature-card" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section class="section split" id="recipes">
        <div>
          <p class="eyebrow">Recipe workflow</p>
          <h2>Ingredients, tags, servings, rich steps, images, and complexity from day one.</h2>
        </div>
        <div class="workflow-panel">
          <ol>
            <li>Choose language, category, tags, and servings.</li>
            <li>Add canonical ingredients with amounts and units.</li>
            <li>Write sanitized rich-text steps and upload an optional image.</li>
            <li>Let similarity checks suggest linking instead of duplicating.</li>
          </ol>
        </div>
      </section>
    </main>
  );
}
