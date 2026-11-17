# كورة البط وبلياردو البط: خطة البناء

**الهدف:** لعبتين جداد بالهب: كورة بكسل ٥ ضد ٥ تنلعب بنفس اللحظة، وبلياردو ٣D بالدور (اللي يدخّل أكثر يفوز).

**التصميم:** `docs/superpowers/specs/2026-11-17-football-billiards-design.md`.

**الأدوات:** Phaser 3 للكورة، three.js للبلياردو، والسيرفر هو الحَكَم (socket.io).

## العقد المشترك (انكتب أول شي)

- **الكورة:**
  - `src/shared/football/types.ts`: الملعب والأوضاع، و FbState (بالحالة)، و FbFrame (١٥ مرة بالثانية)، و FbInput.
  - `src/shared/football/club.ts`: الشخصيات.
- **البلياردو:** `src/shared/pool/types.ts`. اللعبة تمشي على نفس طريق الألعاب الرياضية: phase `sport`، و `GameState.sport`، و `sport:shot`.
- **السيرفر:** `src/server/runner.ts`. أي لعبة لها حلقتها الخاصة تطبّق GameRunner.
- **الربط اللي بنيته:**
  - الغرفة: `start`، و`skip`، و`playFor`، واختيار الشخصية والفريق باللوبي، ومدة المباراة.
  - الأحداث: `fb:input`، و`fb:frame`، و`player:pickChar`، و`player:pickTeam`.
  - الواجهات: `SportView.fbFrame` و`setControl`، و`DisplayHandle.frame` و`fbControl`.
  - اللوبي باللوحة، والكتالوج، ووضع "العب على هالجهاز".

## المهام (تمشي بنفس الوقت، كل وحدة بملفاتها)

1. **البلياردو كامل:**
   - الملفات: `src/shared/pool/*`، و`src/server/pool.ts`، و`src/client/sports/pool-view.ts` + `pool/*`، و`tools/pool-sim.ts`.
   - الصورة المصغرة للهب.
2. **محرك الكورة:**
   - الملفات: `src/shared/football/engine.ts`، و`ai.ts`، و`src/server/football.ts`، و`tools/football-sim.ts`.
   - يشمل: الأشواط، والأهداف، وضربات الترجيح.
3. **عرض الكورة:**
   - الملفات: `src/client/sports/football-view.ts` + `football/*`، ورسومات الملعب بـ `public/assets/football/stadium/`.
   - التحكم باللمس والكيبورد، ووضع "اللوحة بس" جنب البروجكتر.

## الاختبار والمراجعة

- **الاختبارات:**
  - `tsc`.
  - `pool-sim` و`football-sim`.
  - كل الاختبارات القديمة: `room-sim`، و`sport-sim`، و`profile-sim`، و`cards-sim`.
  - `vite build`.
- **صور الشاشات:** تليفون بالطول وبالعرض، وبروجكتر.
- **المراجعة:** مراجعة مستقلة للفرع كامل، وبعدها تصليح المهم.
