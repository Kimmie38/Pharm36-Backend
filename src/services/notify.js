// Push delivery through Expo's HTTP API (works with the Expo Go / EAS builds the app uses).
async function sendExpoPush(token, title, body, data = {}) {
  if (!token || !/^Expo(nent)?PushToken\[.+\]$/.test(token)) return false;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, data, sound: 'default' }),
    });
    return res.ok;
  } catch (e) {
    console.warn('[push] failed:', e.message);
    return false;
  }
}
module.exports = { sendExpoPush };
