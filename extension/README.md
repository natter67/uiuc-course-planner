# Audit import extension

Adds an **Open in Illini Course Planner** button to your uAchieve degree audit. The audit text is
compressed into the link's `#fragment` and opened in the planner. Fragments are never sent to a
server, so your audit goes from your browser to your browser.

## Install (developer mode)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this `extension` folder.
3. Click the extension's icon and set the planner address: `http://localhost:3000` while running
   locally, or your deployed URL.
4. Open your audit in uAchieve: the button appears at the bottom right.

Works in Chrome, Edge, Arc and Brave. The planner also accepts a pasted audit, so the extension is
optional.
