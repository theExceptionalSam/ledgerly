export function naira(n) {
  const v = Number(n) || 0;
  return "₦" + v.toLocaleString("en-NG", { maximumFractionDigits: 0 });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export const statusMeta = {
  paid: { label: "Fully paid", color: "#1B7A43", bg: "#E7F4EC" },
  partial: { label: "Partial", color: "#C77D22", bg: "#FBF0E2" },
  outstanding: { label: "Outstanding", color: "#B3261E", bg: "#FBEAE9" },
  unset: { label: "No fee set", color: "#8A8A82", bg: "#EDECE6" },
};
