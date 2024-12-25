import {beforeEach, vi} from 'vitest';

const originalFetch = global.fetch;
const fetchMock = vi.spyOn(global, 'fetch');
fetchMock.mockImplementation((...args) => {
	const [url] = args;
	if (url === '/__/firebase/init.json') {
		return Promise.resolve(
			new Response(
				JSON.stringify({
					apiKey: 'fakeApiKey',
					projectId: 'solid-start-firebase-template',
				}),
			),
		);
	}
	return originalFetch(...args);
});

beforeEach(async () => {
	// Reset firestore data
	await originalFetch(
		'http://localhost:8080/emulator/v1/projects/solid-start-firebase-template/databases/(default)/documents',
		{
			method: 'DELETE',
		},
	);
});
