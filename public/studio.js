const viewTitles = {
  studio: 'Motion Studio',
  timeline: 'Timeline & Shots',
  qa: 'Technical QA',
};

const navButtons = [...document.querySelectorAll('.nav-item[data-view]')];
const panels = [...document.querySelectorAll('.view-panel[data-panel]')];
const pageTitle = document.getElementById('page-title');
const activeToolLabel = document.getElementById('active-tool');
const promptForm = document.getElementById('prompt-form');
const promptInput = document.getElementById('prompt-input');
const formMessage = document.getElementById('form-message');
const specOutput = document.getElementById('spec-output');
const resultsEmpty = document.getElementById('results-empty');
const resultsContent = document.getElementById('results-content');
const resultProvider = document.getElementById('result-provider');
const submitButton = promptForm.querySelector('button[type="submit"]');
const initialPrompt = promptInput.value;

function showSceneResult(result) {
  const { spec, provider, validatedAt } = result;
  document.getElementById('result-id').textContent = spec.id;
  document.getElementById('result-title').textContent = spec.title;
  document.getElementById('result-dimensions').textContent = `${spec.width} × ${spec.height} @ ${spec.fps} fps`;
  document.getElementById('result-duration').textContent = `${spec.durationInSeconds} seconds`;
  document.getElementById('result-validated-at').textContent = new Date(validatedAt).toLocaleString();
  resultProvider.textContent = `Provider: ${provider}`;
  specOutput.textContent = JSON.stringify(spec, null, 2);
  resultsEmpty.hidden = true;
  resultsContent.hidden = false;
}

function clearSceneResult() {
  formMessage.textContent = '';
  resultProvider.textContent = 'Waiting for a prompt';
  resultsEmpty.hidden = false;
  resultsEmpty.textContent = 'Submit a motion brief to generate and validate a scene specification.';
  resultsContent.hidden = true;
  specOutput.textContent = '';
}

function showView(view) {
  for (const button of navButtons) {
    const isActive = button.dataset.view === view;
    button.classList.toggle('is-active', isActive);
    if (isActive) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  }

  for (const panel of panels) {
    panel.hidden = panel.dataset.panel !== view;
  }

  pageTitle.textContent = viewTitles[view];
}

for (const button of navButtons) {
  button.addEventListener('click', () => showView(button.dataset.view));
}

for (const button of document.querySelectorAll('.tool-pill')) {
  button.addEventListener('click', () => {
    for (const pill of document.querySelectorAll('.tool-pill')) {
      const selected = pill === button;
      pill.classList.toggle('is-selected', selected);
      pill.setAttribute('aria-pressed', String(selected));
    }
    activeToolLabel.textContent = button.querySelector('span').textContent;
  });
}

for (const button of document.querySelectorAll('.category-chip')) {
  button.addEventListener('click', () => {
    button.classList.toggle('is-selected');
    const category = button.textContent.trim();
    const currentPrompt = promptInput.value.trim();
    const categoryText = `Create a ${category.toLowerCase()} motion scene`;
    if (button.classList.contains('is-selected')) {
      if (!currentPrompt) {
        promptInput.value = categoryText;
      } else if (!currentPrompt.toLowerCase().includes(category.toLowerCase())) {
        promptInput.value = `${currentPrompt.replace(/[.\\s]+$/, '')} — ${categoryText}`;
      }
    } else if (currentPrompt === categoryText) {
      promptInput.value = '';
    }
    promptInput.focus();
  });
}

document.getElementById('new-production').addEventListener('click', () => {
  showView('studio');
  promptInput.value = initialPrompt;
  clearSceneResult();
  promptInput.focus();
});

promptForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();

  if (!prompt) {
    formMessage.textContent = 'Enter a motion brief before generating a scene specification.';
    promptInput.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Synthesizing & validating…';
  formMessage.textContent = 'Generating and validating with the configured scene provider…';
  resultProvider.textContent = 'Generating…';
  resultsEmpty.hidden = false;
  resultsContent.hidden = true;
  resultsEmpty.textContent = 'Generating and validating scene specification…';

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        context: {
          width: 1280,
          height: 720,
          fps: 24,
          primaryColor: '#0F172A',
          accentColor: '#38BDF8',
        },
      }),
    });
    const responseText = await response.text();
    let result;
    try {
      result = responseText ? JSON.parse(responseText) : {};
    } catch {
      const detail = responseText.trim().slice(0, 300) || response.statusText;
      throw new Error(`Generation API returned a non-JSON response (HTTP ${response.status}): ${detail}`);
    }

    if (!response.ok || !result.success) {
      throw new Error(result.error || `Generation API failed with HTTP ${response.status}.`);
    }

    formMessage.textContent = `Validated scene specification generated by ${result.provider}. No video render was started.`;
    showSceneResult(result);
  } catch (error) {
    formMessage.textContent = `Could not generate a scene specification: ${error.message}`;
    resultProvider.textContent = 'Generation failed';
    resultsEmpty.textContent = 'No result is available. Correct the brief or try again.';
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Synthesize &amp; validate spec <span aria-hidden="true">↗</span>';
  }
});
