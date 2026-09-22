/**
 * Rebuilds the plugin-rnd-lab feedback form IN PLACE: same form, same link, same response Sheet.
 *
 * Run once:
 *   1. script.google.com  ->  open the project that created the form (or a new project)
 *   2. Replace the editor's contents with this file
 *   3. Pick rebuildFeedbackForm in the function dropdown  ->  Run  ->  allow the permissions
 *      (it asks for Drive read access, to find the form by its public link)
 *   4. The execution log confirms the link and lists every section and question it wrote
 *
 * THE METHOD is Prospector's interview method, turned into a survey
 * (plugins/prospector/skills/start and review): behaviour, not opinion. No question asks whether
 * it helped, whether they liked it, what they would want or what should change. Every question
 * asks what they did, how they did it, or how a specific moment felt, and the two things the form
 * exists to learn are read off those answers, never asked:
 *
 *   Does Prospector help develop a new plugin?
 *     an MVP got built, it was used on real work (how often), it is still installed, the problem
 *     came back and the MVP handled it, the survey sent them to an existing tool instead, their
 *     description of the problem moved from their own words to the framing's, they reached handoff,
 *     they had a real example ready when asked (a made-up one means the tool was tried, not used).
 *
 *   Does Optimizer help optimize one?
 *     the task was real work, runs fired (a second run is a vote with time), what they did after the
 *     report (changed / removed / ran again / nothing), whether the change came from the report or
 *     from something they saw themselves, certainty before and after, their own call against the
 *     report's, "the report showed me something I had not noticed".
 *
 *   Frustrated or happy?
 *     a feeling per step (grids), where they stopped and what was going on at that moment, the most
 *     frustrating moment and what kind it was, the best moment, what they did when lost (a status
 *     command or /core:learn midway is confusion), errors, the overall feeling scale.
 *
 * - Abandonment is the most valuable signal, so every path asks where they stopped and what was
 *   going on, and "stopping early" is made easy to say.
 * - Question 1 routes each respondent to a section about what they actually did: only read it,
 *   install broke, installed and idle, /core:learn only, Prospector, Optimizer. Nobody is asked
 *   about a step they never reached, and the drop-off shows up even from people who never install.
 * - Scales and grids wherever possible; one optional open question, about a single concrete moment.
 *   Required: question 1, and the "did you also use Optimizer?" fork, since both route.
 *
 * NAVIGATION (verified against developers.google.com/apps-script/reference/forms, 2026-09-22):
 * a choice created with createChoice(value, pageBreakItem) jumps after the page holding it is
 * completed; PageBreakItem.setGoToPage(x) sets where the page BEFORE that break goes; a navigating
 * choice on a page overrules the break's setting; navigating items must not use showOtherOption.
 */

const PUBLIC_LINK = 'https://docs.google.com/forms/d/e/1FAIpQLSfINKyrAFuydl9SC-wNGceL_I-04cWqy7BkeQf0IJSwOKxFfg/viewform';

const FEEL = ['Frustrating', 'Tedious', 'Fine', 'Smooth', 'Enjoyable', "Didn't get there"];
const MATCH = ['Not at all', 'A little', 'Somewhat', 'Mostly', 'Completely', "Doesn't apply"];
const TIME_SPENT = ['Under 15 minutes', '15 to 60 minutes', '1 to 3 hours', 'More than 3 hours'];

const PROSPECTOR_STEPS = [
  'The opening interview (/prospector:start)',
  'The search for existing tools (/prospector:survey)',
  'Choosing a framing (/prospector:frame)',
  'The blueprint (/prospector:design)',
  'Getting the MVP built (/prospector:build)',
  'Using the MVP on real work',
  'The review after using it (/prospector:review)',
  'The handoff to Optimizer (/prospector:handoff)',
];

const OPTIMIZER_STEPS = [
  'Choosing the experiments folder (/optimizer:setup)',
  'Creating the experiment (/optimizer:init)',
  'The interview about what the plugin is for (/optimizer:understand)',
  'Writing the task and the checks (/optimizer:plan)',
  'The two windows opening (/optimizer:fire)',
  'Working both sessions',
  'The questions after the run (/optimizer:analyze)',
  'Reading the report',
];

function rebuildFeedbackForm() {
  const form = findFormByPublicLink(PUBLIC_LINK);
  form.getItems().forEach((item) => form.deleteItem(item));

  form
    .setTitle('plugin-rnd-lab: how did it go?')
    .setDescription('Mostly clicks, 2 to 10 minutes depending on how far you got. '
      + 'Stopping early is a fine answer.')
    .setConfirmationMessage('Thanks.')
    .setShowLinkToRespondAgain(false);

  /* -------------------------------------------------------------- start */

  const route = form.addMultipleChoiceItem()
    .setTitle('What did you do with it?')
    .setRequired(true);

  mc(form, 'What were you working on when you came across it?', [
    'Building a new plugin or skill',
    'Improving one I already have',
    'Choosing between plugins someone else made',
    'Nothing plugin-related',
  ], true);

  /* ------------------------------------------------ read, didn't install */

  const readPage = form.addPageBreakItem().setTitle('Reading about it');

  mc(form, 'How much did you read?', [
    'The title or the post',
    'The top of the README',
    'Most of the README',
    'The README and some of the code',
  ]);

  checks(form, 'When you stopped reading, what was going on?', [
    "It didn't match anything I'm working on",
    "I don't build or test plugins",
    'I saw how much setup it takes',
    'I saw the token cost',
    'I already test plugins another way',
    'I saved it for later',
    'I got interrupted',
  ], true);

  checks(form, 'After reading, what did you do?', [
    'Starred or bookmarked it',
    'Sent it to someone',
    'Opened the code',
    'Nothing',
  ], true);

  /* ------------------------------------------------------ install broke */

  const installPage = form.addPageBreakItem().setTitle('The install');

  mc(form, 'Where did it go wrong?', [
    'Adding the marketplace',
    'Installing a plugin',
    'Running the first command',
    'Not sure',
  ]);

  mc(form, 'What did you see?', [
    'An error message',
    'Nothing happened',
    'A command was not found',
    "It asked for something I didn't have",
  ], true);

  mc(form, 'How many times did you try?', ['Once', '2 or 3', 'More than 3']);

  checks(form, 'What did you do next?', [
    'Searched for the error',
    'Asked Claude about it',
    'Tried installing from a clone',
    'Opened an issue',
    'Stopped there',
  ], true);

  scale(form, 'How did that moment feel?', 'Very frustrating', "Didn't bother me");

  /* ------------------------------------------------ installed, ran nothing */

  const idlePage = form.addPageBreakItem().setTitle('After installing');

  mc(form, 'When did you install it?', ['Today', 'This week', 'Longer ago']);

  checks(form, 'Since installing, what has happened?', [
    'Other work took over',
    "I wasn't sure which command to start with",
    "I didn't have a plugin or an idea to point it at",
    "Setup asked for something I didn't have ready",
    'It looked like it would take longer than I had',
    'I read the docs and stopped there',
  ], true);

  checks(form, 'Which of these did you open?', [
    'The README',
    'The list of commands',
    "A skill's own file",
    'None of them',
  ]);

  /* ----------------------------------------------------- /core:learn only */

  const learnPage = form.addPageBreakItem().setTitle('The /core:learn walkthrough');

  mc(form, 'How much of it did you go through?', [
    'The opening',
    'About half',
    'All of it',
    'I skipped around and asked my own questions',
  ]);

  checks(form, 'What did you ask it about?', [
    'Prospector',
    'Optimizer',
    'How the two connect',
    'dod-lite',
    'A question of my own',
    'Nothing, I only read',
  ]);

  grid(form, 'How much does each of these match your time with /core:learn?', [
    'Afterwards I could say what each tool is for',
    'I knew which command to run first',
    'It told me things I already knew',
    'It went on longer than I wanted',
    'I scrolled back to re-read parts',
  ], MATCH);

  scale(form, 'How did going through it feel?', 'Frustrating', 'Enjoyable');

  mc(form, 'Right after it, what did you do?', [
    'Went back to my own work',
    'Read the README',
    'Put it on a list for later',
    'Uninstalled it',
  ], true);

  /* --------------------------------------------- Prospector: what you did */

  const prospectorPage = form.addPageBreakItem().setTitle('Prospector: what you did');

  mc(form, 'What did you bring to it?', [
    'A problem in my own work',
    'An idea for a plugin',
    "A plugin I'd already built, to rethink it",
    'A made-up problem, to try it out',
  ], true);

  mc(form, 'How long had that problem or idea been around?', [
    'Days', 'Weeks', 'Months', 'Longer',
  ]);

  checks(form, 'Which Prospector steps did you get to?', PROSPECTOR_STEPS);

  mc(form, 'How long did you spend on Prospector, all in?', TIME_SPENT);

  mc(form, 'Over how many days?', ['One sitting', '2 or 3 days', 'A week or more']);

  mc(form, 'When it asked about the last time the problem happened, you:', [
    'Had a real example ready',
    'Found one after thinking',
    'Made one up',
    "It didn't ask",
    "Didn't get there",
  ]);

  mc(form, 'How did you answer its questions, mostly?', [
    'A line or two',
    'A paragraph or more',
    'Pasted files, logs or transcripts',
    'A mix',
  ]);

  mc(form, 'The search for existing tools came back with:', [
    'It already exists',
    'Something close exists',
    'Nothing like it',
    "Didn't get there",
  ]);

  mc(form, 'After that search, you:', [
    'Installed what it found',
    'Kept going with my own',
    'Stopped',
    "Didn't get there",
  ]);

  mc(form, 'The framings it offered, you:', [
    'Took one as it was',
    'Took one and changed it',
    'Turned them all down and wrote my own',
    "Didn't get there",
  ]);

  mc(form, 'When you describe the problem to someone today, you use:', [
    'The words I started with',
    'Words from the framing',
    'Something newer than both',
    "Haven't described it since",
  ]);

  mc(form, 'How many times have you used the MVP on real work?', [
    'Never', 'Once', '2 to 5 times', 'More than 5 times', 'No MVP yet',
  ]);

  mc(form, 'Today, that MVP is:', [
    'Installed, and I use it',
    "Installed, and I don't use it",
    'Removed',
    'Never installed',
    'No MVP yet',
  ]);

  mc(form, 'The last time the problem came back:', [
    'The MVP handled it',
    'I used the MVP and finished by hand',
    'I did it the old way',
    "It hasn't come back",
    'No MVP yet',
  ]);

  /* ------------------------------------------- Prospector: how it felt */

  form.addPageBreakItem().setTitle('Prospector: how it felt');

  grid(form, 'How did each part of Prospector feel?', [
    'The opening interview',
    'The search for existing tools',
    'Choosing a framing',
    'The blueprint',
    'Getting the MVP built',
    'Using the MVP',
    'The review',
  ], FEEL);

  grid(form, 'How much does each of these match your time with Prospector?', [
    'The questions were about things I had actually done',
    'I had to repeat things I had already told it',
    'I could see why it asked what it asked',
    'It questioned my first idea of the problem',
    'It moved faster than I could keep up with',
    'I waited on it more than I wanted',
    'I felt in control of where it was going',
    'It found something about my problem I had not seen',
    'The MVP did real work for me',
  ], MATCH);

  checks(form, "In Prospector, when you weren't sure what to do next, you:", [
    'Ran /prospector:status',
    'Went back to /core:learn',
    'Read the README',
    'Asked in the session',
    'Guessed',
    'It never happened',
  ]);

  mc(form, 'Did Prospector error at any point?', ['No', 'Yes, and I got past it', 'Yes, and it stopped me']);

  mc(form, 'Where in Prospector did you stop, or put it down and not come back?',
    PROSPECTOR_STEPS.concat(["I haven't stopped"]));

  checks(form, 'What was going on when you stopped Prospector?', [
    'Something errored',
    "It asked something I couldn't answer",
    'It was taking longer than I had',
    "I wasn't sure what to do next",
    "It was heading somewhere I didn't want",
    'I already had what I came for',
    'It was using more tokens than I wanted',
    "I haven't stopped",
  ], true);

  mc(form, "Prospector's most frustrating moment came during:",
    PROSPECTOR_STEPS.concat(['Nothing frustrated me']));

  mc(form, 'That Prospector moment was mostly:', [
    'Waiting',
    'Repeating myself',
    'Not knowing what to do',
    'It got something wrong',
    'It broke',
    'It went on too long',
    "It took the problem somewhere I didn't mean",
    'Nothing frustrated me',
  ], true);

  mc(form, "Prospector's best moment came during:", PROSPECTOR_STEPS.concat(['None stood out']));

  scale(form, 'Overall, how did your time with Prospector feel?', 'Frustrating', 'Enjoyable');

  const alsoOptimizer = form.addMultipleChoiceItem()
    .setTitle('Did you also use Optimizer?')
    .setRequired(true);

  /* ---------------------------------------------- Optimizer: what you did */

  const optimizerPage = form.addPageBreakItem().setTitle('Optimizer: what you did');

  mc(form, 'What did you test?', [
    'A plugin or skill I built',
    "Someone else's plugin",
    'An MVP Prospector built',
    'Something made up, to try it out',
  ], true);

  checks(form, 'Which Optimizer steps did you get to?',
    OPTIMIZER_STEPS.concat(['A second run', 'The write-up of all runs (/optimizer:paper)']));

  mc(form, 'How many runs have you fired?', ['None', '1', '2', '3 or more']);

  mc(form, 'The task both sessions got was:', [
    'Work I had to do anyway',
    'A task I made up for the test',
    'A task /optimizer:plan suggested',
    "Didn't get there",
  ]);

  mc(form, 'The checks it wrote before the run, you:', [
    'Kept as written',
    'Edited some',
    'Rewrote most',
    "Didn't read them",
    "Didn't get there",
  ]);

  checks(form, 'Which files it wrote did you open?', [
    'mandate.md',
    'task.md',
    'The check files',
    'The report',
    'ledger.md',
    'None of them',
  ]);

  mc(form, 'When the two windows opened, you worked them:', [
    'One after the other',
    'Back and forth',
    'Mostly one, the other briefly',
    'Only one of them',
    "They didn't open",
    "Didn't get there",
  ]);

  mc(form, 'You typed something into one session and not the other:', [
    'Often', 'A few times', 'Never', "Don't know", "Didn't get there",
  ]);

  mc(form, 'Each session ran for about:', TIME_SPENT.concat(["Didn't get there"]));

  mc(form, 'How long did you spend on Optimizer, all in?', TIME_SPENT);

  mc(form, 'Before reading the report, your own call was:', [
    'The session with the plugin went better',
    'The session without it went better',
    'No real difference',
    "I hadn't decided",
    "Didn't get there",
  ]);

  mc(form, 'The report said:', [
    'The session with the plugin did better',
    'The session without it did better',
    'No clear difference',
    'Mixed',
    'No report yet',
  ]);

  scale(form, 'Before you started: how sure were you that the plugin you tested helps?',
    'No idea', 'Certain');

  scale(form, 'After the report: how sure are you now?', 'No idea', 'Certain');

  checks(form, 'After the report, you:', [
    'Changed the plugin',
    'Fired another run',
    'Kept the plugin as it was',
    'Disabled or removed the plugin',
    'Showed the report to someone',
    'Nothing yet',
    'No report yet',
  ]);

  mc(form, 'If you changed the plugin, the change came from:', [
    'Something in the report',
    'Something I saw while working the two sessions',
    "Something I'd planned anyway",
    "I didn't change it",
  ]);

  /* -------------------------------------------- Optimizer: how it felt */

  form.addPageBreakItem().setTitle('Optimizer: how it felt');

  grid(form, 'How did each part of Optimizer feel?', [
    'Choosing the experiments folder',
    'Creating the experiment, and its interview',
    'Writing the task and the checks',
    'The two windows opening',
    'Working both sessions',
    'The questions after the run',
    'Reading the report',
  ], FEEL);

  grid(form, 'How much does each of these match your time with Optimizer?', [
    'The task felt like work I would do anyway',
    'At each step I knew what to do next',
    'I understood what the checks were checking',
    'Keeping the two sessions equal took effort',
    'Working two sessions at once wore me out',
    'I felt in control of what it was doing',
    'I believed the numbers in the report',
    'The report showed me something I had not noticed',
  ], MATCH);

  checks(form, "In Optimizer, when you weren't sure what to do next, you:", [
    'Ran /optimizer:status',
    'Went back to /core:learn',
    'Read the README',
    'Asked in the session',
    'Guessed',
    'It never happened',
  ]);

  mc(form, 'Did Optimizer error at any point?', ['No', 'Yes, and I got past it', 'Yes, and it stopped me']);

  mc(form, 'Where in Optimizer did you stop, or put it down and not come back?',
    OPTIMIZER_STEPS.concat(["I haven't stopped"]));

  checks(form, 'What was going on when you stopped Optimizer?', [
    'Something errored',
    "The windows didn't open",
    'It was taking longer than I had',
    "I wasn't sure what to do next",
    'Working two sessions was too much',
    'I already had what I came for',
    'It was using more tokens than I wanted',
    "I haven't stopped",
  ], true);

  mc(form, "Optimizer's most frustrating moment came during:",
    OPTIMIZER_STEPS.concat(['Nothing frustrated me']));

  mc(form, 'That Optimizer moment was mostly:', [
    'Waiting',
    'Repeating myself',
    'Not knowing what to do',
    'It got something wrong',
    'It broke',
    'It went on too long',
    'Keeping two sessions in step',
    'Nothing frustrated me',
  ], true);

  mc(form, "Optimizer's best moment came during:", OPTIMIZER_STEPS.concat(['None stood out']));

  scale(form, 'The tokens it used, compared with what you expected:', 'Far fewer', 'Far more');

  scale(form, 'Overall, how did your time with Optimizer feel?', 'Frustrating', 'Enjoyable');

  /* ----------------------------------------------------------- about you */

  const aboutPage = form.addPageBreakItem().setTitle('About you');

  mc(form, 'How often do you use Claude Code?', [
    'Every day', 'A few times a week', 'Less often',
  ]);

  mc(form, 'How many Claude Code plugins or skills have you written?', [
    'None', '1', '2 to 5', '6 or more',
  ]);

  mc(form, 'How many plugins do you have installed right now?', [
    'None', '1 to 3', '4 to 10', 'More than 10', 'Not sure',
  ]);

  mc(form, 'In the last month, how many plugins or skills did you install and later remove?', [
    'None', '1 or 2', '3 to 5', '6 or more',
  ]);

  checks(form, 'Before this, how did you tell whether a plugin or skill was helping?', [
    'I went by feel',
    'I compared sessions by hand',
    'I wrote evals, or used claude plugin eval',
    'I watched tokens or cost',
    "I didn't check",
  ], true);

  mc(form, 'Which operating system?', ['Windows', 'macOS', 'Linux'], true);

  mc(form, 'Where did you find this?', [
    'A Reddit post',
    'GitHub',
    'Someone sent it to me',
  ], true);

  /* ----------------------------------------------------------- last page */

  form.addPageBreakItem().setTitle('Last page');

  form.addParagraphTextItem()
    .setTitle('Tell me about one moment that went differently from what you expected. What were you doing?');

  mc(form, 'Could I ask you about it in a 15-minute chat?', ['Yes', 'No']);

  form.addTextItem()
    .setTitle('If yes: your GitHub or Reddit handle');

  /* ------------------------------------------------------------- routing */

  route.setChoices([
    route.createChoice("Read about it, didn't install it", readPage),
    route.createChoice("Tried to install it, and it didn't work", installPage),
    route.createChoice("Installed it, haven't run anything yet", idlePage),
    route.createChoice('Ran /core:learn, nothing else', learnPage),
    route.createChoice('Used Prospector', prospectorPage),
    route.createChoice('Used Optimizer, not Prospector', optimizerPage),
  ]);

  alsoOptimizer.setChoices([
    alsoOptimizer.createChoice('Yes', optimizerPage),
    alsoOptimizer.createChoice('No', aboutPage),
  ]);

  // Each short path ends at "About you". setGoToPage on a break routes the page BEFORE it.
  installPage.setGoToPage(aboutPage);    // after "Reading about it"
  idlePage.setGoToPage(aboutPage);       // after "The install"
  learnPage.setGoToPage(aboutPage);      // after "After installing"
  prospectorPage.setGoToPage(aboutPage); // after "The /core:learn walkthrough"
  // "Optimizer: how it felt" runs straight on into "About you"; the Prospector path leaves
  // through alsoOptimizer.

  console.log('Rebuilt, same link: ' + form.getPublishedUrl());
  let n = 0;
  form.getItems().forEach((item) => {
    if (item.getType() === FormApp.ItemType.PAGE_BREAK) console.log('== ' + item.getTitle());
    else console.log('   ' + (++n) + '. ' + item.getTitle());
  });
}

/* --------------------------------------------------------------- helpers */

function mc(form, title, choices, other) {
  return form.addMultipleChoiceItem()
    .setTitle(title)
    .setChoiceValues(choices)
    .showOtherOption(Boolean(other));
}

function checks(form, title, choices, other) {
  return form.addCheckboxItem()
    .setTitle(title)
    .setChoiceValues(choices)
    .showOtherOption(Boolean(other));
}

function grid(form, title, rows, columns) {
  return form.addGridItem().setTitle(title).setRows(rows).setColumns(columns);
}

function scale(form, title, low, high) {
  return form.addScaleItem().setTitle(title).setBounds(1, 5).setLabels(low, high);
}

/** The form the public link points at, found in your Drive: the link carries no edit id. */
function findFormByPublicLink(link) {
  const wanted = publicId(link);
  const files = DriveApp.getFilesByType(MimeType.GOOGLE_FORMS);
  while (files.hasNext()) {
    const form = FormApp.openById(files.next().getId());
    if (publicId(form.getPublishedUrl()) === wanted) return form;
  }
  throw new Error('No form in your Drive has the public link ' + link);
}

function publicId(url) {
  const m = String(url).match(/\/forms\/d\/e\/([^/]+)/);
  return m ? m[1] : null;
}
