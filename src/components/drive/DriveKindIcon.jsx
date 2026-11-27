// File-type icon for a Drive file. kind = sheet | doc | slides | pdf | image |
// video | file | folder; anything else draws as a plain file.
const PAGE = "M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5";

const KINDS = {
  sheet: { color: "text-[#188038]", label: "Sheet", d: `${PAGE}M8 12h8M8 16h8M12 11v7` },
  doc: { color: "text-[#1A73E8]", label: "Doc", d: `${PAGE}M8 12h8M8 15h8M8 18h5` },
  slides: { color: "text-[#E37400]", label: "Slides", d: `${PAGE}M8 12h8v5H8z` },
  pdf: { color: "text-[#D93025]", label: "PDF", d: `${PAGE}M8 13h3M8 16h6` },
  image: { color: "text-[#9334E6]", label: "Image", d: `${PAGE}M8 18l3-4 2 2 2-3 2 5H8z` },
  video: { color: "text-[#C2185B]", label: "Video", d: `${PAGE}M10 12v5l4-2.5-4-2.5z` },
  folder: {
    color: "text-[#5F6368]",
    label: "Folder",
    d: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  },
  file: { color: "text-gray-400", label: "File", d: PAGE },
};

export default function DriveKindIcon(props) {
  const k = () => KINDS[props.kind] ?? KINDS.file;
  return (
    <svg
      class={`w-4 h-4 flex-shrink-0 ${k().color}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      role="img"
      aria-label={k().label}
    >
      <path d={k().d} />
    </svg>
  );
}
