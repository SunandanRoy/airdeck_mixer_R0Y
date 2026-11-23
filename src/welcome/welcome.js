document.getElementById('demo')?.addEventListener('click', () => {
  location.href = chrome.runtime.getURL('src/demo/demo.html');
});
document.getElementById('pin')?.addEventListener('click', () => {
  document.getElementById('pin-help')?.classList.toggle('hidden');
});
