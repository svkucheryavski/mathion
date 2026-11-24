// Synthetic test app: draws one sine period into #app-root.
const root = document.getElementById('app-root');
const c = document.createElement('canvas');
c.width = 400; c.height = 200;
root.appendChild(c);
const g = c.getContext('2d');
g.beginPath();
for (let x = 0; x <= 400; x++) {
  const y = 100 - 80 * Math.sin((x / 400) * 2 * Math.PI);
  if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
}
g.stroke();
