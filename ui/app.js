async function loadStatus() {
  try {
    const [lastRes, rewardsRes, statusRes] = await Promise.all([
      fetch('/last-payout'),
      fetch('/reward-cache'),
      fetch('/status')
    ]);

    const last = await lastRes.json();
    const rewards = await rewardsRes.json();
    const status = await statusRes.json();

    // Last payout display
    const statusEl = document.getElementById('last-payout');
    if (!last.last) {
      statusEl.textContent = '❌ No payout recorded yet';
      statusEl.style.color = 'red';
    } else {
      const date = new Date(last.last);
      statusEl.textContent = `✅ Last payout: ${date.toLocaleString()}`;
      if (Date.now() - date.getTime() > 2 * 24 * 60 * 60 * 1000) {
        statusEl.textContent += ' ⚠️ (Over 2 days ago)';
        statusEl.style.color = 'red';
      }
    }

    // Unpaid rewards table
    const rewardTable = document.getElementById('reward-table');
    rewardTable.innerHTML = '';
    const sorted = Object.entries(rewards)
      .filter(([, amt]) => amt > 0)
      .sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0) {
      rewardTable.innerHTML = '<tr><td colspan="2">✅ No unpaid rewards</td></tr>';
    } else {
      for (const [user, amt] of sorted) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>@${user}</td><td>${amt.toFixed(6)} HIVE</td>`;
        rewardTable.appendChild(tr);
      }
    }

    // Curation total
    document.getElementById('curation-total').textContent = `${status.curation_total.toFixed(6)} HIVE`;

    // Delegators table
    const delegatorTable = document.getElementById('delegators-table');
    delegatorTable.innerHTML = '';
    for (const [user, hp] of Object.entries(status.delegators)) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>@${user}</td><td>${hp.toFixed(3)} HP</td>`;
      delegatorTable.appendChild(tr);
    }
  } catch (err) {
    console.error(err);
    document.getElementById('last-payout').textContent = '❌ Failed to load dashboard';
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
