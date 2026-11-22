# FridgeWise — MVP

*What should I cook today?* A simple app for managing the food in your fridge, tracking expiry dates and suggesting recipes from what you already have.

## How to run
No installation is needed. Open `index.html` in any modern browser (Chrome, Edge, Firefox, Safari, or a phone browser).
Data is saved in the browser on your device (`localStorage`), so it stays there when you reload.

To try it quickly, click **Load sample fridge** on the empty screen. This loads the "Daniel" scenario from the spec, with the cottage cheese expiring today.

## MVP features (spec §7.1)
| Spec requirement | Where in the app |
|---|---|
| Add products manually (name, quantity, expiry) | **+** button → Add product dialog |
| Show the product list | *My Fridge* tab, grouped by category or sorted by expiry |
| Expiry tracking: green / orange / red | Colour stripe and badge on each product (orange = 3 days or less, red = today or expired) |
| What Should I Cook Today? | Big green button / *Cook* tab |
| Priority for items expiring soon | Recipes using them get bonus points and show a "⏰ Uses soon-to-expire" note |
| Show missing ingredients | Each recipe card lists ✓ in your fridge / ✗ missing |
| Edit and delete products | Tap a product to edit it; **−1** uses one unit; **✓** removes it (with Undo) |

### Measures against users dropping off (spec §7.3)
- **Less typing:** product names autocomplete, with quick-pick buttons. A known product fills in its category, unit and a suggested expiry date.
- **Immediate value:** after 2–3 products you get a "you can already get recipe ideas" prompt.
- **One-tap consumption:** the ✓ and −1 buttons on every row.
- **Gentle reminder:** a dismissible banner appears if the inventory hasn't been updated for 3+ days.

## How recipe matching works
`js/logic.js → scoreRecipes()`
- Products that have already expired are **never** counted as available. Products expiring today still count.
- Score = % of required ingredients you have + 5 per optional ingredient you have + 40 for each matched item expiring today / 30 for each one expiring in 1–3 days.
- Pantry basics (salt, oil, water, sugar, spices) are assumed to be in the house.
- Names are normalised (for example, "Yellow cheese" counts as "cheese" and "Tomato" as "tomatoes") through the alias table in `js/data.js`.

## Files
- `index.html`: app shell
- `styles.css`: styles (mobile first, light and dark mode)
- `js/data.js`: product list (for autocomplete and default shelf life) and 28 recipes
- `js/storage.js`: saving and loading with localStorage
- `js/logic.js`: expiry status, ingredient matching, recipe scoring
- `js/app.js`: UI rendering and events

## Not in this version (spec §9–10)
AI agent, barcode scanning, push notifications, automatic shopping list, shared family fridge, cloud sync.
