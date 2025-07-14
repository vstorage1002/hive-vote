async function loadStatus() {
  try {
    const res = await fetch('/last-payout');
    const data = await res.json();

    const statusEl = document.getElementById('last-payout');
    if (!data.last) {
      statusEl.textContent = '❌ No payout recorded yet';
      statusEl.style.color = 'red';
    } else {
      const date = new Date(data.last);
      statusEl.textContent = `✅ Last payout: ${date.toLocaleString()}`;
      const delay = Date.now() - date.getTime();
      if (delay > 2 * 24 * 60 * 60 * 1000) {
        statusEl.textContent += ' ⚠️ (Over 2 days ago)';
        statusEl.style.color = 'red';
      }
    }

    const rewardRes = await fetch('/reward-cache');
    const rewardData = await rewardRes.json();
    const tbody = document.getElementById('reward-table');
    tbody.innerHTML = '';

    const sorted = Object.entries(rewardData)
      .filter(([, amt]) => amt > 0)
      .sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="2">✅ No unpaid rewards</td>';
      tbody.appendChild(row);
    }

    for (const [user, amt] of sorted) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>@${user}</td><td>${amt.toFixed(6)} HIVE</td>`;
      tbody.appendChild(tr);
    }
  } catch (e) {
    console.error('Failed to load status:', e);
    document.getElementById('last-payout').textContent = '❌ Failed to load status';
  }
}

async function triggerPayout() {
  const confirmed = confirm('Are you sure you want to manually run payout now?');
  if (!confirmed) return;

  try {
    const res = await fetch('/run-payout', { method: 'POST' });
    const result = await res.text();
    alert(result);
    loadStatus();
  } catch (err) {
    alert('❌ Failed to run payout manually.');
  }
}

loadStatus();
