# 🥗 FridgeWise

**What should I cook today?**

FridgeWise is a simple web app that helps you manage the food in your fridge, keep track of expiry dates and decide what to cook with what you already have. Recipes that use food about to expire come first, which cuts food waste and saves time and money.

> A student group project. This is the first version (MVP) from our project spec.

---

## ✨ Features

| | Feature | What it does |
|---|---|---|
| ➕ | **Quick add** | Tap a common product tile or type a name (with autocomplete). Category, unit and a suggested expiry date fill in automatically. Quick buttons set the expiry: tomorrow / 3 days / 1 week / 2 weeks / 1 month. |
| 🧊 | **My Fridge** | Every product with an emoji icon, quantity and expiry, grouped by category or sorted by expiry date. You can search and filter. |
| 🚦 | **Expiry colours** | 🟢 more than 3 days left · 🟠 1–3 days · 🔴 expires today or already expired |
| ⏰ | **Use it soon** | A card at the top of the home screen shows what's about to expire, with a button to cook with it. |
| 🍳 | **What Should I Cook Today?** | Recipes ranked by how well they match your fridge, with a match %, what you have ✓ and what you still need. |
| 🎯 | **Expiring-first priority** | Recipes that use soon-to-expire food get a boost. Expired food is never suggested. |
| ✅ | **One-tap updates** | **−1** marks one unit as used, **✓** removes a product (with Undo), and tapping a product opens it for editing. |
| 🔎 | **Filters** | Ready now (nothing missing) · Under 20 min · Vegetarian |
| 👋 | **Gentle reminder** | A friendly nudge appears if you haven't updated your fridge for 3+ days. |
| 🌗 | **Light & dark mode** | Follows your device setting. Mobile-first design. |

---

## 🚀 How to run

No installation is needed.

1. Download or clone the repository:
   ```bash
   git clone https://github.com/adansaabni-web/group-.git
   ```
2. Open **`index.html`** in any modern browser (Chrome, Edge, Firefox, Safari, or a phone browser).

Your data is saved in the browser on your own device (`localStorage`). Nothing is sent to a server.

### Try the demo
On the empty screen, click **Try a sample fridge**. This loads the scenario from our spec: Daniel the student has milk, eggs, cucumbers, yellow cheese, tomatoes that expire in 2 days and cottage cheese that expires **today**.

Press **What should I cook today?** and the app suggests a **cottage cheese pan pie** first. It also shows that the pasta recipe still needs pasta and garlic.

---

## 🎙️ Voice agent

Tap the 🎙️ button and just talk: *"What can I cook in 20 minutes?"*, *"I bought milk and 6 eggs"*, *"I finished the tomatoes"*.

It's built on the [OpenAI Realtime API](https://developers.openai.com/api/docs/guides/voice-agents) (speech-to-speech over WebRTC, model `gpt-realtime-2.1`). The agent uses tools that run on your fridge data: `get_fridge`, `suggest_recipes`, `get_recipe`, `add_item` and `use_item`.

Voice needs the small local server, so that your API key never reaches the browser:

1. Create a file called **`.env`** in the project folder containing:
   ```
   OPENAI_API_KEY=sk-...your key...
   ```
   `.env` is in `.gitignore`. **Never commit it.**
2. Start the server (PowerShell 7):
   ```bash
   pwsh -File server/serve.ps1
   ```
3. Open **http://localhost:5178**.

The server gives the browser a short-lived key (10 minutes) through `POST /token`. Everything else in the app still works without the server or a key.

---

## 🧠 How recipe matching works

The scoring lives in `js/logic.js` → `scoreRecipes()`:

```
score = % of required ingredients you have
      + 5   for each optional ingredient you have
      + 40  for each matched item that expires today
      + 30  for each matched item that expires in 1–3 days
```

- Food that has already **expired is never counted** as available.
- Pantry basics (salt, oil, water, sugar, spices) are assumed to be at home.
- Ingredient names are normalised, so "Yellow cheese" counts as *cheese* and "Tomato" counts as *tomatoes*.
- There are 28 simple recipes built in (shakshuka, pasta, salads, omelettes, soups and more).

---

## 🗂️ Project structure

```
├── index.html        App shell: screens, tab bar, add/edit bottom sheet
├── styles.css        "Fresh & friendly" design, light & dark mode
├── js/
│   ├── data.js       Products, emoji icons, recipes, name aliases
│   ├── storage.js    Save/load with localStorage
│   ├── logic.js      Expiry status, ingredient matching, recipe scoring
│   └── app.js        Rendering and user interactions
├── CLAUDE.md         Guidance for AI-assisted development
└── README.md
```

It's built with plain **HTML, CSS and JavaScript**: no frameworks, no build step, no dependencies. The only thing loaded from the internet is the Nunito font, and the app still works offline.

---

## 🛣️ Roadmap (planned for later versions)

- 🤖 AI agent: ask things like *"What can I cook in 20 minutes?"* and get suggestions for substitute ingredients
- 📷 Barcode scanning for faster adding
- 🔔 Push notifications before food expires
- 🛒 Automatic shopping list from missing ingredients
- 📅 Weekly meal planning
- 🥦 Dietary preferences (vegan, gluten-free, …)
- 👨‍👩‍👧 Shared fridge for families and roommates, with cloud sync

**Not planned:** a direct smart-fridge connection, camera recognition of the whole fridge, supermarket ordering, and calorie tracking.

---

## 🎯 Success goals (to be tested with 15 students over 2 weeks)

- 80% of users can add 5 products without help
- 80% of users find a fitting recipe within 2 minutes
- 60% of users come back during the second week
- 50% of soon-to-expire products get used before their date

*These are goals we plan to test, not results yet.*
