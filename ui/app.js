async function loadStatus() {
  const res = await fetch('/last-payout');
  const data = await res.json();

  const statusEl = document.getElementById('last-payout');
  if (!data.last) {
    statusEl.textContent = '❌ No payout recorded yet';
    statusEl.style.color = 'red';
  } else {
    const date = new Date(data.last);
    statusEl.textContent = `✅ Last payout: ${date.toLocaleString()}`;
    if (Date.now() - new Date(data.last).getTime() > 48 * 3600 * 1000) {
      statusEl.style.color = 'red';
      statusEl.textContent += ' ⚠️ (More than 2 days ago)';
    }
  }

  const rewardRes = await fetch('/reward-cache');
  const rewardData = await rewardRes.json();
  const tbody = document.getElementById('reward-table');
  tbody.innerHTML = '';

  for (const user in rewardData) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>@${user}</td><td>${rewardData[user].toFixed(6)} HIVE</td>`;
    tbody.appendChild(tr);
  }
}

async function triggerPayout() {
  const confirmed = confirm('Are you sure you want to run payout now?');
  if (!confirmed) return;
  const res = await fetch('/run-payout', { method: 'POST' });
  const result = await res.text();
  alert(result);
  loadStatus(); // reload info
}

loadStatus();
