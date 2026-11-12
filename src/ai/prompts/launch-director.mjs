/**
 * Storyboard instructions for launch films (context.launch), added to the
 * storyboard request alongside STORYBOARD_DIRECTOR.
 *
 * The launch planner (src/production/launch.mjs) chooses each shot's motion
 * device from the form of its copy, so this teaches the model those forms. Keep
 * it in sync with launch.mjs when devices change.
 */
export const LAUNCH_DIRECTOR = `Launch style (this film): camera-led kinetic type on soft light, every cut and word on the music's beat. The engine stages each shot from the form of its onScreenCopy, so write copy in these forms:
- Opening shot: a short line of three to six words ending with a period ("Your idea deserves motion."). It builds word by word, and the camera dives into its closing period.
- Product shots: for each uploaded photo you use, give one shot the photo's number in "product" (1 is the first photo) and two to seven words about what that product is or does. The copy builds beside the photo.
- A list of three or four items in one line ("With neroli, mandarin, frankincense & lavender.") swaps its items on the beat.
- Two to four very short sentences ("Exact copy. Your fonts. On the beat.") become a checklist that ticks on the beat.
- A line written entirely in quotation marks ("“A 15-second launch film for Volt Runner”") is typed into a prompt card and clicked. Use it only when the brief is about asking an app or a tool for something.
- A short line with a number taken from the brief ("3 formats, one story.") counts up to it. Never invent a number.
- One or two words ("Exact.") land as a punch.
- Final shot: the brand or product name, or a closing line of up to six words.
Rules: one idea per shot and at most nine words; use the brief's own words and never invent claims, prices, numbers or offers; vary the forms across the film. Give each shot time to read: about 0.4 seconds plus 0.06 seconds per character, and more for calm moods. musicMood sets the pace: "energetic" (about 120 BPM) for bold tech or product drops; "premium" (about 90 BPM) for calm, luxury, beauty, skincare or wellness; "editorial" for precise, technical brands; "warm" for handmade or homely ones. Use 4 to 7 shots.`;
