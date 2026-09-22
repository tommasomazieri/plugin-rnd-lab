/**
 * Builds the plugin-rnd-lab feedback form, and a Google Sheet that collects every response.
 *
 * Run once:
 *   1. script.google.com  ->  New project
 *   2. Replace the editor's contents with this file
 *   3. Pick createFeedbackForm in the function dropdown  ->  Run  ->  allow the permissions
 *   4. The execution log under the editor prints the link to share, the link to edit, and the sheet
 *
 * Running it again makes a second, separate form. Edit wording in the form editor afterwards,
 * not here, or you will split responses across two forms.
 *
 * Only question 1 is required. It is the funnel: which step people reach, and where they stop,
 * is the most useful thing a demo launch can learn, and it has to be answerable by someone who
 * only read the post.
 */
function createFeedbackForm() {
  const form = FormApp.create('plugin-rnd-lab: how did it go?');
  form
    .setDescription('About two minutes. Only the first question is required.')
    .setConfirmationMessage('Thanks, this helps.')
    .setShowLinkToRespondAgain(false);

  form.addMultipleChoiceItem()
    .setTitle('How far did you get?')
    .setChoiceValues([
      'Read about it, did not install',
      'Installed it',
      'Ran /core:learn',
      'Used Prospector on an idea',
      'Set up an Optimizer experiment (init and plan)',
      'Fired a paired run',
      'Got an analysis report',
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Which operating system?')
    .setChoiceValues(['Windows', 'macOS', 'Linux'])
    .showOtherOption(true);

  form.addParagraphTextItem()
    .setTitle('Where did you stop, and what stopped you?');

  form.addParagraphTextItem()
    .setTitle('Did anything break?')
    .setHelpText('Paste the error if there was one, and which terminal you were using.');

  form.addTextItem()
    .setTitle('What did you try it on?')
    .setHelpText('A plugin, a skill, or an idea for one.');

  form.addMultipleChoiceItem()
    .setTitle('Have you used claude plugin eval?')
    .setChoiceValues(['Yes', 'No, but I knew about it', 'Did not know it existed']);

  form.addMultipleChoiceItem()
    .setTitle('For your own plugin, which would you reach for?')
    .setChoiceValues(['claude plugin eval', 'Optimizer', 'Both', 'Neither']);

  form.addParagraphTextItem()
    .setTitle('Why?');

  form.addScaleItem()
    .setTitle('If you ran a paired session: was it worth the time and tokens?')
    .setBounds(1, 5)
    .setLabels('Not at all', 'Clearly yes');

  form.addMultipleChoiceItem()
    .setTitle('Did the report tell you something you did not already know?')
    .setChoiceValues(['Yes', 'Partly', 'No', 'Did not get a report']);

  form.addParagraphTextItem()
    .setTitle('What one change would make you use it again?');

  form.addTextItem()
    .setTitle('GitHub or Reddit handle, if a follow-up question is OK');

  const sheet = SpreadsheetApp.create('plugin-rnd-lab feedback (responses)');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  // New forms are published by default; make sure, where the account supports the setting.
  if (form.supportsAdvancedResponderPermissions() && !form.isPublished()) {
    form.setPublished(true);
  }

  console.log('Share this link:  ' + form.getPublishedUrl());
  console.log('Edit the form:    ' + form.getEditUrl());
  console.log('Responses sheet:  ' + sheet.getUrl());
}
