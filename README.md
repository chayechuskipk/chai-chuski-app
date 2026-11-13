# Chai Chuski POS ☕ (GitHub Pages + Firebase)

Cafe billing / POS — GitHub Pages par chalta hai, data Firebase (Firestore) mein save hota hai. Internet thori der ke liye chala jaye to bhi orders bante rehte hain, wapis aane par sync ho jate hain.

## Pages
POS · Order History · Manage Products · Manage Expenses · Manage Customers · Manage Loan · Receipt Print · Settings

## Setup
1. Firebase console mein project banayein → **Authentication** → Email/Password enable → admin user add karein.
2. **Firestore Database** banayein → `firestore.rules` ka content Rules tab mein paste karein (apni email daal kar).
3. Project settings → Web app add karein → config `js/firebase-config.js` mein paste karein.
4. GitHub repo → Settings → Pages → Branch `main` / root → Save.
5. Site kholein, login karein → **Settings** se cancel password set karein aur "Chai Chuski Menu Load Karein" dabayein.

## Naya staff
Firebase → Authentication → Add user, aur `firestore.rules` mein uski email list mein daal dein.
