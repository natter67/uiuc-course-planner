// Runs on uAchieve audit pages. Adds a button that sends the audit to Illini Course Planner.
// The audit is read from the page's markup (never your name or student ID), compressed, and put
// in the planner link's #fragment, which browsers never send to any server.
// Build: npm run ext:build  (bundles this file into extension/content.js)

import { serializeAuditDocument } from "../../src/lib/auditDom";
import { encodeAudit } from "../../src/lib/auditImport";

declare const chrome: { storage: { sync: { get: (d: Record<string, string>) => Promise<Record<string, string>> } } };

const DEFAULT_PLANNER = "http://localhost:3000";
let plannerUrl = DEFAULT_PLANNER;
chrome.storage.sync.get({ plannerUrl: DEFAULT_PLANNER }).then((v) => (plannerUrl = v.plannerUrl || DEFAULT_PLANNER));

const isAuditPage = () => !!document.querySelector("div.requirement .reqTitle");

async function send(button: HTMLButtonElement) {
  // Open the tab during the click itself: browsers block pop-ups opened after an await.
  const tab = window.open("about:blank", "_blank");
  button.disabled = true;
  button.textContent = "Opening planner…";
  try {
    const payload = await encodeAudit(serializeAuditDocument(document));
    const url = `${plannerUrl.replace(/\/+$/, "")}/#audit=${payload}`;
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.href = url;
    }
    button.textContent = "Sent to planner";
  } catch (e) {
    tab?.close();
    button.textContent = "Couldn't send. Copy the audit instead.";
    console.error("[Illini Course Planner]", e);
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = "Open in Illini Course Planner";
    }, 4000);
  }
}

function addButton() {
  if (!isAuditPage() || document.getElementById("icp-send")) return;
  const button = document.createElement("button");
  button.id = "icp-send";
  button.type = "button";
  button.textContent = "Open in Illini Course Planner";
  button.addEventListener("click", () => send(button));
  document.body.appendChild(button);
}

addButton();
new MutationObserver(addButton).observe(document.body, { childList: true });
