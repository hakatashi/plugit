import {test, expect} from 'vitest';
import {render, waitFor} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import Index from './index.js';

const user = userEvent.setup();

test('has add task button', async () => {
	const {getByRole} = render(() => <Index />);
	const addTaskButton = getByRole('button');
	expect(addTaskButton).toHaveTextContent('Add Task');
});

test('is able to add task', async () => {
	const {getByRole, getByText, getAllByRole} = render(() => <Index />);

	{
		const taskInput = getByRole('textbox');
		expect(taskInput).toHaveValue('');

		const addTaskButton = getByText('Add Task');
		expect(addTaskButton).not.toBeDisabled();

		const tasks = getAllByRole('listitem');
		expect(tasks).toHaveLength(1);

		await user.type(taskInput, 'Hello, World!');
		await user.click(addTaskButton);
	}

	await waitFor(
		() => {
			const taskInput = getByRole('textbox');
			expect(taskInput).toHaveValue('');
		},
		{
			timeout: 1000,
		},
	);

	{
		const tasks = getAllByRole('listitem');
		expect(tasks).toHaveLength(2);

		const lastTask = tasks[tasks.length - 2];
		expect(lastTask).toHaveTextContent('Hello, World!');
	}
});
