import { transitionProject } from '../src/orchestrator/project-state.mjs';

export default function transition(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ success: false, error: 'Method not allowed.' });
  }
  const { project, nextState, evidence } = request.body || {};
  try {
    return response.status(200).json({
      success: true,
      project: transitionProject(project, nextState, evidence),
    });
  } catch (error) {
    return response.status(400).json({ success: false, error: error.message });
  }
}
