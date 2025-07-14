async function loadDashboard() {
  try {
    // Load last payout from payout.log
    const logText = await fetch('payout.log').then(r => r.text());
    const lines = logText.trim().split('\n');
    const lastEntry = lines.pop();
    const lastDateStr = lastEntry?.split(' - ')[0];
    const lastDate = new Date(lastDateStr);

    const lastPayoutEl = document.getElementById('last-payout');
    if (!isNaN(lastDate)) {
      const now = new Date();
      const diffDays = (now - lastDate) / (1000 * 60 * 60 * 24);
      lastPayoutEl.textContent = `✅ Last payout: ${lastDate.toLocaleString()}`;
      if (diffDays > 1.5) {
        lastPayoutEl.classList.add('warn');
        lastPayoutEl.textContent += ' ⚠️ Missed payout (over 1 day ago)';
      }
    } else {
      lastPayoutEl.textContent = '❌ No valid payout logs found.';
      lastPayoutEl.classList.add('warn');
    }

    // Load reward cache
    const rewardData = await fetch('reward_cache.json').then(r => r.json());
    const tbody = document.getElementById('reward-table');
    tbody.innerHTML = '';
    for (const user in rewardData) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>@${user}</td><td>${rewardData[user].toFixed(6)} HIVE</td>`;
      tbody.appendChild(tr);
    }
  } catch (err) {
    document.getElementById('last-payout').textContent = '⚠️ Failed to load dashboard data.';
    console.error(err);
  }
}

loadDashboard();
