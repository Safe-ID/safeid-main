export const C = {
  bg: "#040C1A",
  bgCard: "#071220",
  bgHover: "#0B1A2E",
  border: "#152338",
  borderL: "#1E3554",
  primary: "#1A6FFF",
  primaryD: "#1255CC",
  secondary: "#38BDF8",
  accent: "#86EFAC",
  text: "#EEF4FF",
  muted: "#7A9DC0",
  dim: "#3A5A80",
  danger: "#F87171",
  warn: "#FCD34D",
};

export const BREACHES = [
  { name: "LinkedIn",     date: "2021-06-22", classes: ["Email addresses","Geographic locations","Job titles","Names","Phone numbers"], count: 700000000, color: "#0A8FFF" },
  { name: "Adobe",        date: "2019-10-04", classes: ["Email addresses","Passwords","Usernames","Credit card data"],                  count: 153000000, color: "#FF3B30" },
  { name: "Dropbox",      date: "2016-08-31", classes: ["Email addresses","Passwords"],                                                  count:  68648009, color: "#0061FF" },
  { name: "MyFitnessPal", date: "2018-03-25", classes: ["Email addresses","IP addresses","Passwords","Usernames"],                       count: 143606147, color: "#00B4D8" },
];

export const W = {
  "Passwords": 10, "Credit card data": 10, "Bank account numbers": 10,
  "Email addresses": 3, "Usernames": 2, "Phone numbers": 4,
  "Names": 2, "Geographic locations": 2, "Job titles": 1, "IP addresses": 3,
};

export function score(bs) {
  if (!bs.length) return 0;
  let t = 0;
  bs.forEach(b => { t += Math.max(...b.classes.map(c => W[c] || 2)); });
  const raw = (t / bs.length / 10) * 100;
  const bonus = bs.some(b => new Date(b.date).getFullYear() >= 2022) ? 10 : 0;
  return Math.min(Math.round(raw + bonus), 100);
}
