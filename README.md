# SM Online Shop — Full E-commerce Production Starter

Included:
- Responsive customer storefront
- Cart + checkout
- Cash on Delivery
- bKash / Nagad / Bank-Card payment choices in checkout
- Real order API with stock reduction
- Admin login + dashboard
- Product add/edit/delete + stock
- Order list
- Store settings
- Facebook page link
- Contact: 01827872334 / 01886995687

ADMIN
Username: SMADMIN
Password: SM2728

RUN LOCALLY
1. Install Node.js 18+.
2. Open terminal in this folder.
3. Run: npm install
4. Run: npm start
5. Open: http://localhost:3000
6. Admin: http://localhost:3000/admin.html

PAYMENTS — IMPORTANT
The checkout UI supports COD, bKash, Nagad and Bank/Card selection.
COD is operational in this starter.
bKash, Nagad and card payments CANNOT be genuinely activated without the
merchant credentials issued to your shop by the payment provider.

Use .env.example as the credential template. Do NOT put real secrets into
frontend HTML/JS. For a live deployment, use server-side credentials and HTTPS.

For Bangladesh card payments, SSLCommerz or another approved gateway can be
connected in server.js. bKash and Nagad require their current merchant/API
onboarding and credentials.

SECURITY
- Change SESSION_SECRET before production.
- The supplied admin username/password are exactly what you requested.
- Use HTTPS and a proper database for a public production store.
- Replace JSON storage with MySQL/PostgreSQL for serious order volume.
