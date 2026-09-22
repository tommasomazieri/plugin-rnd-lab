/**
 * Rebuilds the plugin-rnd-lab feedback form IN PLACE: same form, same link, same response Sheet.
 *
 * Run once:
 *   1. script.google.com  ->  open the project that created the form (or a new project)
 *   2. Replace the editor's contents with this file
 *   3. Pick rebuildFeedbackForm in the function dropdown  ->  Run  ->  allow the permissions
 *      (it asks for Drive read access, to find the form by its public link)
 *   4. The execution log confirms the link and lists the questions it wrote
 *
 * The method is Prospector's interview method, turned into a survey
 * (plugins/prospector/skills/start and review): behaviour, not opinion. Every question asks what
 * the respondent did, where they stopped, what they went back to, and how each moment felt —
 * never whether they liked it, would use it, or what should change. People report what they did
 * far better than they predict what they would do, and "was it useful?" gets a polite answer that
 * predicts nothing.
 *
 * - Abandonment is the most valuable signal, so where they stopped and what was happening at
 *   that moment get their own questions, and stopping early is made an easy answer to give.
 * - "Could you point it at real work and run it?" comes before anything that presumes it worked.
 * - Before/after certainty measures what the run did to their belief, without asking for a verdict.
 * - What they did afterwards is the strongest answer in the form: a changed or removed plugin is
 *   evidence, a star rating is not.
 * - Scales and grids wherever possible; one optional open question, about a single concrete
 *   moment. Only question 1 is required: someone who only read the post can still answer it,
 *   which is how the drop-off shows up even from people who never install.
 */

const PUBLIC_LINK = 'https://docs.google.com/forms/d/e/1FAIpQLSfINKyrAFuydl9SC-wNGceL_I-04cWqy7BkeQf0IJSwOKxFfg/viewform';

function rebuildFeedbackForm() {
  const form = findFormByPublicLink(PUBLIC_LINK);
  form.getItems().forEach((item) => form.deleteItem(item));

  form
    .setTitle('plugin-rnd-lab: how did it go?')
    .setDescription('About three minutes, mostly clicks. Only the first question is required.')
    .setConfirmationMessage('Thanks.')
    .setShowLinkToRespondAgain(false);

  /* ------------------------------------------------------------ what you did */

  form.addMultipleChoiceItem()
    .setTitle('How far did you get?')
    .setChoiceValues([
      'Read about it, did not install',
      'Installed it',
      'Ran /core:learn',
      'Used Prospector on an idea',
      'Set up an Optimizer experiment (init and plan)',
      'Ran the two sessions',
      'Got a report',
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('What did you point it at?')
    .setChoiceValues([
      'A plugin or skill I built',
      "Someone else's plugin or skill",
      "An idea I haven't built yet",
      'Nothing yet',
    ]);

  form.addMultipleChoiceItem()
    .setTitle('Could you point it at real work and actually run it?')
    .setChoiceValues(['Yes', 'Partly', 'No', "Didn't try"]);

  form.addMultipleChoiceItem()
    .setTitle('How long did you spend on it, all in?')
    .setChoiceValues(['Under 15 minutes', '15 to 60 minutes', '1 to 3 hours', 'More than 3 hours']);

  form.addCheckboxItem()
    .setTitle('If you stopped before a report: what was happening when you stopped?')
    .setHelpText('Stopping early is a fine answer.')
    .setChoiceValues([
      'Something errored',
      'It was taking longer than I had',
      'I was not sure what to do next',
      'It was using more tokens than I wanted',
      'I had seen enough',
      'I did not stop, I got a report',
    ])
    .showOtherOption(true);

  form.addCheckboxItem()
    .setTitle('When you stopped, what did you go back to?')
    .setChoiceValues([
      'Using my plugins without testing them',
      'Judging by feel',
      'Comparing sessions by hand',
      'Evals, or claude plugin eval',
      'Nothing changed, I was not testing plugins before',
    ])
    .showOtherOption(true);

  /* ------------------------------------------------------------- how it felt */

  form.addPageBreakItem().setTitle('How it went');

  form.addGridItem()
    .setTitle('How did each part feel?')
    .setRows([
      'Installing',
      'The /core:learn walkthrough',
      "Prospector's interview",
      'Setting up an experiment (setup, init, plan)',
      'Working the two sessions side by side',
      'Reading the report',
    ])
    .setColumns(['Frustrating', 'Tedious', 'Fine', 'Smooth', 'Enjoyable', "Didn't get there"]);

  form.addGridItem()
    .setTitle('How much does each of these match what happened to you?')
    .setRows([
      'At each step I knew what to do next',
      'I understood what each of the two sessions was for',
      'Working both sessions felt like my normal work',
      'I felt in control of what it was doing',
      'I believed the numbers in the report',
    ])
    .setColumns(['Not at all', 'A little', 'Somewhat', 'Mostly', 'Completely', "Doesn't apply"]);

  form.addScaleItem()
    .setTitle('Before you started: how sure were you that the plugin you tested helps?')
    .setBounds(1, 5)
    .setLabels('No idea', 'Certain');

  form.addScaleItem()
    .setTitle('After the report: how sure are you now?')
    .setHelpText("Skip it if you didn't get a report.")
    .setBounds(1, 5)
    .setLabels('No idea', 'Certain');

  form.addCheckboxItem()
    .setTitle('After it, what did you do?')
    .setChoiceValues([
      'Changed the plugin',
      'Ran it again',
      'Kept the plugin as it was',
      'Removed or disabled the plugin',
      'Told someone about the result',
      'Nothing yet',
      "Didn't get that far",
    ]);

  /* ----------------------------------------------------------- before this */

  form.addPageBreakItem().setTitle('Before this');

  form.addCheckboxItem()
    .setTitle('Before this, how did you tell whether a plugin or skill was helping?')
    .setChoiceValues([
      'I went by feel',
      'I compared sessions by hand',
      'I wrote evals, or used claude plugin eval',
      'I watched tokens or cost',
      "I didn't check",
    ])
    .showOtherOption(true);

  form.addMultipleChoiceItem()
    .setTitle('In the last month, how many plugins or skills did you install and later remove?')
    .setChoiceValues(['None', '1 or 2', '3 to 5', '6 or more']);

  form.addMultipleChoiceItem()
    .setTitle('Which operating system?')
    .setChoiceValues(['Windows', 'macOS', 'Linux'])
    .showOtherOption(true);

  form.addParagraphTextItem()
    .setTitle('Tell me about one moment that went differently from what you expected. What were you doing?');

  form.addMultipleChoiceItem()
    .setTitle('Could I ask you about it in a 15-minute chat?')
    .setChoiceValues(['Yes', 'No']);

  form.addTextItem()
    .setTitle('If yes: your GitHub or Reddit handle');

  console.log('Rebuilt, same link: ' + form.getPublishedUrl());
  form.getItems().forEach((item, i) => console.log((i + 1) + '. ' + item.getTitle()));
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
