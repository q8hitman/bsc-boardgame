/** The BSC club members who play كورة البط. Sprite strips: /assets/football/<id>-blue.png and <id>-red.png
 *  (the referee: zahraa-ref.png). Each strip = 6 frames of 64x72 px, left to right: idle, run1, run2, run3, run4, kick.
 *  Drawn facing right; flip for left. Feet on the bottom row - 1, centred horizontally. */
export const CLUB: { id: string; name: string }[] = [
  { id: "abdullah", name: "عبدالله" },
  { id: "motivator", name: "المحفّز" },
  { id: "ahmad", name: "أحمد" },
  { id: "camel", name: "الجمل" },
  { id: "abdulrahman", name: "عبدالرحمن" },
  { id: "fayzah", name: "فايزة" },
  { id: "rawan", name: "روان" },
  { id: "shouq", name: "شوق" },
  { id: "loujain", name: "لجين" },
  { id: "bassam", name: "بسام" },
  { id: "ali", name: "علي" },
  { id: "ruaa", name: "رؤى" },
  { id: "hora", name: "حوراء" },
  { id: "zainab", name: "زينب" },
  { id: "amna", name: "آمنة" },
  { id: "tima", name: "تيما" },
  { id: "hajar", name: "هاجر" },
  { id: "abdullah2", name: "عبدالله أ" },
  { id: "jenan", name: "جنان" },
  { id: "maha", name: "مها" },
  { id: "samiyeh", name: "سامية" },
  { id: "ritaj", name: "رتاج" },
  { id: "sheikha", name: "شيخة" },
  { id: "aya", name: "آية" },
  { id: "maryam", name: "مريم" },
  { id: "haneen", name: "حنين" },
];
export const REFEREE = { id: "zahraa", name: "د. زهراء" };
export const FRAME_W = 64;
export const FRAME_H = 72;
export const FRAMES = ["idle", "run1", "run2", "run3", "run4", "kick"] as const;
export const isClubChar = (id: string) => CLUB.some((c) => c.id === id);
