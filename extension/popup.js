const input = document.getElementById("url");
chrome.storage.sync.get({ plannerUrl: "http://localhost:3000" }).then(({ plannerUrl }) => (input.value = plannerUrl));
document.getElementById("save").addEventListener("click", async () => {
  const value = input.value.trim() || "http://localhost:3000";
  await chrome.storage.sync.set({ plannerUrl: value });
  document.getElementById("saved").hidden = false;
});
