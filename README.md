# Hacker Sports Facility: member app

A small installable web app (PWA). No build step, no npm. Just static files.

## Try it on your computer (demo data)

Browsers need the files served over http (not double-clicked) for modules and the service worker. From this `app` folder:

    python -m http.server 8080

Then open <http://localhost:8080/>. While `API_URL` is empty the app runs on demo data (you will see a "Demo data" badge). Sign in with any email and the code `123456`. Use `alex@example.com` to see the regular-member view. The badge also switches between owner and member views. Add `?mock` to the address to force demo data even after `API_URL` is set.

## Publish to GitHub Pages (web UI only)

1. On github.com, click **New repository**. Name it (for example `hacker-sports`), make it **Public**, and create it.
2. Click **Add file → Upload files**. Drag in the **contents** of this `app` folder (index.html, app.js, `icons` and `views` folders, and so on, not the `app` folder itself). Commit.
3. Go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, and Save.
4. After a minute the app is live at `https://<your-username>.github.io/<repo-name>/`.

## Connect it to the booking engine

1. Deploy the Apps Script project as a Web app (Execute as: Me, Who has access: Anyone) and copy the `/exec` URL.
2. Edit `config.js` and paste the URL between the quotes: `export const API_URL = 'https://script.google.com/macros/s/.../exec';`
3. Commit the change. Phones pick up the new files automatically the next time they open the app online.
4. In the Settings tab of the spreadsheet, set `APP_URL` to the GitHub Pages address.

## Install on a phone

- **iPhone:** open the address in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap the **menu (three dots)**, then **Install app**.
