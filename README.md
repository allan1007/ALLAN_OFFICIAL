# ALLAN Streetwear Store

A custom dark streetwear storefront with a private admin dashboard, PostgreSQL product/order storage, and Stripe Checkout.

## What is included

- Responsive ALLAN storefront (homepage, product collection, product detail modal, shopping bag)
- Admin dashboard at `/admin.html`
- Add, edit, hide and delete products
- Manage prices, image URLs, descriptions, categories, sizes, stock and featured products
- Edit homepage headline, announcement, hero image, About text, contact email and Instagram link
- Orders list
- Stripe Checkout integration (SGD)
- Stripe webhook marks paid orders as paid
- PostgreSQL persistence suitable for Render

## Run locally

1. Install Node.js 20 or newer.
2. Create a PostgreSQL database.
3. Copy `.env.example` to `.env`.
4. Fill in `DATABASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, and Stripe test keys.
5. Run:

   ```bash
   npm install
   npm start
   ```

6. Open `http://localhost:3000`.
7. Open `http://localhost:3000/admin.html` to manage the store.

## Deploy to Render

1. Create a new GitHub repository and upload the contents of this folder (not the ZIP file itself).
2. In Render, choose **New + → Blueprint** and connect the repository. Render reads `render.yaml`.
3. During setup, provide:
   - `ADMIN_PASSWORD`: a strong, unique password for the store admin.
   - `STRIPE_SECRET_KEY`: your Stripe **test** secret key (`sk_test_...`) to begin with.
   - `STRIPE_WEBHOOK_SECRET`: your Stripe webhook signing secret (instructions below).
   - `SITE_URL`: your exact Render URL, e.g. `https://allan-store.onrender.com`.
4. Render creates the web service and PostgreSQL database. Wait for the first deployment to finish.
5. Visit `https://YOUR-SITE/admin.html` and sign in with `ADMIN_PASSWORD`.

If you already have a Render service from an older ALLAN project, you can deploy this as a new service first. Do not overwrite the old service until you have tested the new one.

## Connect Stripe

1. In Stripe Dashboard, turn on **Test mode**.
2. Copy the test secret key from Developers → API keys into Render as `STRIPE_SECRET_KEY`.
3. In Stripe Developers → Webhooks, add endpoint:
   `https://YOUR-SITE/api/stripe/webhook`
4. Subscribe to `checkout.session.completed`.
5. Copy the endpoint's signing secret (`whsec_...`) into Render as `STRIPE_WEBHOOK_SECRET`.
6. Redeploy after changing environment variables.
7. Test a purchase using Stripe's test card `4242 4242 4242 4242`, a future expiry date, any CVC and a valid email.

Do not put Stripe secret keys in frontend files or share them with anyone. Never use live keys until you have tested checkout and are ready to accept real payments.

## Edit your store

- Visit `/admin.html`.
- Products tab: add/edit/delete products. Use publicly accessible HTTPS image URLs.
- Website Content tab: change homepage text, hero image, brand story, email and Instagram.
- Orders tab: view orders and payment status.

## Important notes before launch

- This starter uses Stripe-hosted Checkout. Configure shipping, taxes, refunds and business details in Stripe before launch.
- Product stock is displayed and checked before checkout, but this starter does not decrement stock after payment. Add inventory deduction and size-level stock tracking before relying on stock counts for a large launch.
- Upload product images to a stable image host (for example, a storage service) and paste their HTTPS URLs into the dashboard. This starter does not include binary image uploads.
- Add your own policies (shipping, returns, privacy, terms), business contact details and actual product photos before taking live orders.
- `render.yaml` creates a paid Render Postgres plan; check Render's current pricing before confirming.
