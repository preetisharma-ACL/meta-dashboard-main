export default function Avatar(props) {
  const AVATAR_PALETTE = [
    "bg-purple-700",
    "bg-blue-700",
    "bg-emerald-700",
    "bg-amber-700",
    "bg-rose-700",
    "bg-indigo-700",
  ];

  const getInitials = (name) => {
    const s = String(name ?? "").trim();

    if (!s) return "?";

    const words = s.match(/[A-Z][a-z]*/g);

    if (words && words.length >= 2) {
      return (
        words[0][0] + words[words.length - 1][0]
      ).toUpperCase();
    }

    return s.slice(0, 2).toUpperCase();
  };

  const getColor = (str) => {
    const s = String(str ?? "");

    return s
      ? AVATAR_PALETTE[
          s.charCodeAt(0) % AVATAR_PALETTE.length
        ]
      : AVATAR_PALETTE[0];
  };

  return (
    <div
      class={`
        ${props.size || "w-8 h-8"}
        ${getColor(props.name)}
        rounded-full flex items-center justify-center
        text-white font-bold flex-shrink-0
        ${props.class || ""}
      `}
    >
      <span class={props.textSize || "text-xs"}>
        {getInitials(props.name)}
      </span>
    </div>
  );
}