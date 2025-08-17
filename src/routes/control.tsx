import {
	createSignal,
	For,
	Match,
	onCleanup,
	onMount,
	Switch,
	type Component,
} from 'solid-js';
import {ButtplugWasmClientConnector} from 'buttplug-wasm/dist/buttplug-wasm.mjs';
import {ButtplugClient, type ButtplugClientDevice} from 'buttplug';
import styles from './control.module.css';

// Body part mapping for devices
type BodyPart = 'rightNipple' | 'leftNipple' | 'clitoris' | 'vagina' | 'mixed';

// Motor/Actuator mapping for individual device motors
type MotorMapping = {
	device: ButtplugClientDevice;
	motorIndex: number;
	motorType: 'vibrate' | 'rotate';
};

// Device mapping state - now maps body parts to specific motors
type DeviceMapping = {
	[key in BodyPart]?: MotorMapping[];
};

// Gamepad button mapping
const BUTTON_MAPPING = {
	0: 'clitoris', // A button
	1: 'vagina', // B button
	2: 'leftNipple', // X button
	3: 'rightNipple', // Y button
} as const;

const Control: Component = () => {
	const [buttplugClient, setButtplugClient] =
		createSignal<ButtplugClient | null>(null);
	const [devices, setDevices] = createSignal<ButtplugClientDevice[]>([]);
	const [deviceMapping, setDeviceMapping] = createSignal<DeviceMapping>({});
	const [gamepadConnected, setGamepadConnected] = createSignal(false);
	const [gamepadIndex, setGamepadIndex] = createSignal<number>(-1);
	const [globalStrength, setGlobalStrength] = createSignal(0.5);
	const [alwaysOnMode, setAlwaysOnMode] = createSignal<Set<BodyPart>>(
		new Set(),
	);

	// Previous button states to detect double presses
	const [prevButtonStates, setPrevButtonStates] = createSignal<boolean[]>([]);
	const [buttonPressTimes, setButtonPressTimes] = createSignal<number[]>([]);

	// Debug state for gamepad
	const [gamepadState, setGamepadState] = createSignal({
		buttons: [] as boolean[],
		axes: [] as number[],
		id: '',
		timestamp: 0,
	});

	// Expected device state for periodic sync
	const [expectedDeviceState, setExpectedDeviceState] = createSignal<{
		[key in Exclude<BodyPart, 'mixed'>]: {
			strength: number;
			rotationSpeed: number;
		};
	}>({
		rightNipple: {strength: 0, rotationSpeed: 0},
		leftNipple: {strength: 0, rotationSpeed: 0},
		clitoris: {strength: 0, rotationSpeed: 0},
		vagina: {strength: 0, rotationSpeed: 0},
	});

	// Command history for debugging
	type CommandHistoryEntry = {
		timestamp: number;
		deviceName: string;
		bodyPart: BodyPart;
		motorIndex: number;
		motorType: 'vibrate' | 'rotate';
		command: string;
		value: number | number[];
		source: 'gamepad' | 'sync' | 'manual';
	};

	const [commandHistory, setCommandHistory] = createSignal<
		CommandHistoryEntry[]
	>([]);

	const addToCommandHistory = (
		deviceName: string,
		bodyPart: BodyPart,
		motorIndex: number,
		motorType: 'vibrate' | 'rotate',
		command: string,
		value: number | number[],
		source: 'gamepad' | 'sync' | 'manual' = 'gamepad',
	) => {
		const entry: CommandHistoryEntry = {
			timestamp: Date.now(),
			deviceName,
			bodyPart,
			motorIndex,
			motorType,
			command,
			value,
			source,
		};

		setCommandHistory((prev) => {
			const newHistory = [entry, ...prev];
			return newHistory.slice(0, 10); // Keep only last 10 commands
		});
	};

	// Timers
	let gamepadTimer: ReturnType<typeof setInterval> | undefined;
	let deviceSyncTimer: ReturnType<typeof setInterval> | undefined;

	const onDeviceAdded = (device: ButtplugClientDevice) => {
		console.log(`Device added: ${device.name}`);
		setDevices((prev) => [...prev, device]);
	};

	const onClickConnect = async () => {
		if (buttplugClient() === null) {
			const client = new ButtplugClient('Control Client');
			await ButtplugWasmClientConnector.activateLogging();
			await client.connect(new ButtplugWasmClientConnector());
			setButtplugClient(client);
		}

		const client = buttplugClient()!;
		await client.startScanning();
		client.addListener('deviceadded', onDeviceAdded);
	};

	const mapMotorToBodyPart = (
		device: ButtplugClientDevice,
		motorIndex: number,
		motorType: 'vibrate' | 'rotate',
		bodyPart: BodyPart,
	) => {
		const motorMapping: MotorMapping = {
			device,
			motorIndex,
			motorType,
		};

		setDeviceMapping((prev) => ({
			...prev,
			[bodyPart]: [...(prev[bodyPart] || []), motorMapping],
		}));
	};

	const removeMotorFromBodyPart = (
		device: ButtplugClientDevice,
		motorIndex: number,
		motorType: 'vibrate' | 'rotate',
		bodyPart: BodyPart,
	) => {
		setDeviceMapping((prev) => ({
			...prev,
			[bodyPart]: (prev[bodyPart] || []).filter(
				(mapping) =>
					!(
						mapping.device === device &&
						mapping.motorIndex === motorIndex &&
						mapping.motorType === motorType
					),
			),
		}));
	};

	const updateExpectedState = (
		bodyPart: Exclude<BodyPart, 'mixed'>,
		strength: number,
		rotationSpeed: number = 0,
	) => {
		setExpectedDeviceState((prev) => ({
			...prev,
			[bodyPart]: {strength, rotationSpeed},
		}));
	};

	const sendAllDeviceCommands = (
		source: 'gamepad' | 'sync' | 'manual' = 'gamepad',
	) => {
		const mapping = deviceMapping();
		const currentState = expectedDeviceState();

		// Group all motor mappings by device to send accumulated commands
		const deviceCommands = new Map<
			ButtplugClientDevice,
			{
				vibrations: number[];
				rotations: Array<{Index: number; Speed: number; Clockwise: boolean}>;
				commandLog: Array<{
					bodyPart: BodyPart;
					motorIndex: number;
					motorType: 'vibrate' | 'rotate';
					command: string;
					value: number | number[];
				}>;
			}
		>();

		// Collect all active motor mappings from all body parts
		for (const bodyPart of [
			'rightNipple',
			'leftNipple',
			'clitoris',
			'vagina',
		] as Array<Exclude<BodyPart, 'mixed'>>) {
			const motorMappings = mapping[bodyPart];
			const state = currentState[bodyPart];

			if (!motorMappings || motorMappings.length === 0) continue;

			for (const motorMapping of motorMappings) {
				const {device, motorIndex, motorType} = motorMapping;

				if (!deviceCommands.has(device)) {
					deviceCommands.set(device, {
						vibrations: new Array(device.vibrateAttributes.length).fill(0),
						rotations: device.rotateAttributes.map((_, index) => ({
							Index: index,
							Speed: 0,
							Clockwise: true,
						})),
						commandLog: [],
					});
				}

				const deviceCommand = deviceCommands.get(device)!;

				if (
					motorType === 'vibrate' &&
					device.vibrateAttributes.length > motorIndex
				) {
					deviceCommand.vibrations[motorIndex] = state.strength;
					deviceCommand.commandLog.push({
						bodyPart,
						motorIndex,
						motorType,
						command: 'vibrate',
						value: state.strength,
					});
				}

				if (
					motorType === 'rotate' &&
					device.rotateAttributes.length > motorIndex
				) {
					deviceCommand.rotations[motorIndex].Speed = Math.abs(
						state.rotationSpeed,
					);
					deviceCommand.rotations[motorIndex].Clockwise =
						state.rotationSpeed > 0;
					deviceCommand.commandLog.push({
						bodyPart,
						motorIndex,
						motorType,
						command: 'rotate',
						value: Math.abs(state.rotationSpeed),
					});
				}
			}
		}

		// Send accumulated commands to each device
		for (const [device, commands] of deviceCommands) {
			// Send vibration command if any vibrators are mapped
			if (device.vibrateAttributes.length > 0) {
				device.vibrate(commands.vibrations);

				// Log vibration command
				addToCommandHistory(
					device.name,
					'mixed', // Since it's accumulated from multiple body parts
					-1, // Multiple motors
					'vibrate',
					'vibrate',
					commands.vibrations,
					source,
				);
			}

			// Send rotation command if any rotators are mapped
			if (device.rotateAttributes.length > 0) {
				device.rotate(
					commands.rotations.map(
						(r) => [r.Speed, r.Clockwise] as [number, boolean],
					),
				);

				// Log rotation command
				addToCommandHistory(
					device.name,
					'mixed', // Since it's accumulated from multiple body parts
					-1, // Multiple motors
					'rotate',
					'rotate',
					commands.rotations.map((r) => r.Speed),
					source,
				);
			}
		}
	};

	const controlDevice = (
		bodyPart: Exclude<BodyPart, 'mixed'>,
		strength: number,
		rotationSpeed: number = 0,
	) => {
		// Update expected state
		updateExpectedState(bodyPart, strength, rotationSpeed);
		// Send accumulated commands to all devices
		sendAllDeviceCommands('gamepad');
	};

	const syncAllDevices = () => {
		// Send current expected state to all devices
		sendAllDeviceCommands('sync');
	};

	let tick = 0;

	const pollGamepad = () => {
		tick++;

		const gamepads = navigator.getGamepads();
		const gamepad = gamepads[gamepadIndex()];

		if (!gamepad) {
			setGamepadConnected(false);
			return;
		}

		const currentButtonStates = gamepad.buttons.map((button) => button.pressed);
		const prevStates = prevButtonStates();
		const currentTime = Date.now();

		// Update debug state
		setGamepadState({
			buttons: currentButtonStates,
			axes: [...gamepad.axes],
			id: gamepad.id,
			timestamp: gamepad.timestamp,
		});

		// Check for button presses
		for (let i = 0; i < Math.min(4, gamepad.buttons.length); i++) {
			const bodyPart = BUTTON_MAPPING[
				i as keyof typeof BUTTON_MAPPING
			] as Exclude<BodyPart, 'mixed'>;
			const isPressed = currentButtonStates[i];
			const wasPressed = prevStates[i] || false;
			if (tick % 60 === 0) {
				console.log(
					`[control] ${bodyPart}: ${isPressed ? '🟢 Pressed' : '⚪ Released'}`,
				);
				console.log(
					`[control] ${bodyPart} (prev): ${wasPressed ? '🟢 Pressed' : '⚪ Released'}`,
				);
			}

			// Detect button press (not held)
			if (isPressed && !wasPressed) {
				const triggerPressed =
					gamepad.buttons[6]?.pressed || gamepad.buttons[7]?.pressed; // L2/R2 triggers

				if (triggerPressed) {
					// Special trigger mode operations
					const pressTimes = buttonPressTimes();
					const lastPressTime = pressTimes[i] || 0;
					const timeSinceLastPress = currentTime - lastPressTime;

					if (timeSinceLastPress < 500) {
						// Double press - turn off always-on mode
						setAlwaysOnMode((prev) => {
							const newSet = new Set(prev);
							newSet.delete(bodyPart);
							return newSet;
						});
						console.log(`Turned off always-on mode for ${bodyPart}`);
					} else {
						// Single press - turn on always-on mode
						setAlwaysOnMode((prev) => new Set(prev).add(bodyPart));
						console.log(`Turned on always-on mode for ${bodyPart}`);
					}

					// Update press times
					setButtonPressTimes((prev) => {
						const newTimes = [...prev];
						newTimes[i] = currentTime;
						return newTimes;
					});
				} else {
					// Regular button press - activate device
					console.log(
						`[control] Activating device for ${bodyPart} with strength ${globalStrength()}`,
					);
					controlDevice(bodyPart, globalStrength());
				}
			} else if (!isPressed && wasPressed) {
				// Button released - stop device if not in always-on mode
				console.log(`[control] Deactivating device for ${bodyPart}`);
				if (!alwaysOnMode().has(bodyPart)) {
					controlDevice(bodyPart, 0);
				}
			} else if (alwaysOnMode().has(bodyPart)) {
				// Always-on mode - keep device active
				controlDevice(bodyPart, globalStrength());
			}
		}

		// Handle stick rotation for nipple devices
		const leftStick = {
			x: gamepad.axes[0] || 0,
			y: gamepad.axes[1] || 0,
		};

		// Calculate rotation speed and direction from stick input
		const stickMagnitude = Math.sqrt(
			leftStick.x * leftStick.x + leftStick.y * leftStick.y,
		);
		const rotationDirection = Math.atan2(leftStick.y, leftStick.x);

		if (stickMagnitude > 0.1) {
			// Dead zone
			const rotationSpeed = stickMagnitude * (rotationDirection > 0 ? -1 : 1);
			controlDevice('leftNipple', 0, rotationSpeed);
			controlDevice('rightNipple', 0, rotationSpeed);
		} else {
			controlDevice('leftNipple', 0, 0);
			controlDevice('rightNipple', 0, 0);
		}

		// Handle trigger for strength adjustment
		const triggerPressed =
			gamepad.buttons[6]?.pressed || gamepad.buttons[7]?.pressed;
		if (triggerPressed) {
			// Check for stick up press for strength adjustment
			const stickUp = leftStick.y < -0.8;
			const stickWasUp = prevStates.length > 0; // Simplified state tracking

			if (stickUp && !stickWasUp) {
				setGlobalStrength((prev) => Math.min(1, prev + 0.1));
				console.log(`Strength increased to ${globalStrength()}`);
			}
		}

		setPrevButtonStates(currentButtonStates);
	};

	// Gamepad connection detection
	const detectGamepad = () => {
		const gamepads = navigator.getGamepads();
		for (let i = 0; i < gamepads.length; i++) {
			if (gamepads[i]) {
				setGamepadIndex(i);
				setGamepadConnected(true);
				console.log(`Gamepad connected: ${gamepads[i]!.id}`);
				return;
			}
		}
		setGamepadConnected(false);
	};

	onMount(() => {
		// Start gamepad detection
		detectGamepad();
		gamepadTimer = setInterval(() => {
			if (gamepadConnected()) {
				pollGamepad();
			} else {
				detectGamepad();
			}
		}, 16); // ~60fps polling

		// Start device sync timer - sync every second
		deviceSyncTimer = setInterval(() => {
			if (devices().length > 0) {
				syncAllDevices();
			}
		}, 1000); // Sync every 1 second

		// Listen for gamepad events
		window.addEventListener('gamepadconnected', detectGamepad);
		window.addEventListener('gamepaddisconnected', () => {
			setGamepadConnected(false);
			setGamepadIndex(-1);
		});
	});

	onCleanup(() => {
		if (gamepadTimer) {
			clearInterval(gamepadTimer);
		}
		if (deviceSyncTimer) {
			clearInterval(deviceSyncTimer);
		}
		window.removeEventListener('gamepadconnected', detectGamepad);
		window.removeEventListener('gamepaddisconnected', detectGamepad);
	});

	return (
		<div class={styles.container}>
			<h1>PlugIt Controller</h1>

			{/* Connection Section */}
			<section class={styles.section}>
				<h2>Connection</h2>
				<button
					type="button"
					class={styles.connectButton}
					onClick={onClickConnect}
				>
					Connect Buttplug
				</button>
				<div class={styles.statusText}>
					<p>
						Gamepad: {gamepadConnected() ? '✅ Connected' : '❌ Not Connected'}
					</p>
					<p>Global Strength: {Math.round(globalStrength() * 100)}%</p>
					<p>Devices: {devices().length} connected</p>
					{devices().length > 0 && <p>🔄 Device sync: Every 1 second</p>}
				</div>
			</section>

			{/* Gamepad Debug Section */}
			{gamepadConnected() && (
				<section class={styles.section}>
					<h2>Gamepad Debug</h2>
					<div class={styles.controls}>
						<p>
							<strong>ID:</strong> {gamepadState().id}
						</p>
						<p>
							<strong>Timestamp:</strong> {gamepadState().timestamp}
						</p>

						<h3>Buttons:</h3>
						<div class={styles.debugGrid}>
							<div class={styles.debugItem}>
								A (Clitoris):{' '}
								{gamepadState().buttons[0] ? '🟢 Pressed' : '⚪ Released'}
							</div>
							<div class={styles.debugItem}>
								B (Vagina):{' '}
								{gamepadState().buttons[1] ? '🟢 Pressed' : '⚪ Released'}
							</div>
							<div class={styles.debugItem}>
								X (Left Nipple):{' '}
								{gamepadState().buttons[2] ? '🟢 Pressed' : '⚪ Released'}
							</div>
							<div class={styles.debugItem}>
								Y (Right Nipple):{' '}
								{gamepadState().buttons[3] ? '🟢 Pressed' : '⚪ Released'}
							</div>
							<div class={styles.debugItem}>
								L1: {gamepadState().buttons[4] ? '🟢 Pressed' : '⚪ Released'}
							</div>
							<div class={styles.debugItem}>
								R1: {gamepadState().buttons[5] ? '🟢 Pressed' : '⚪ Released'}
							</div>
							<div class={styles.debugItem}>
								L2 (Trigger):{' '}
								{gamepadState().buttons[6] ? '🟢 Pressed' : '⚪ Released'}
							</div>
							<div class={styles.debugItem}>
								R2 (Trigger):{' '}
								{gamepadState().buttons[7] ? '🟢 Pressed' : '⚪ Released'}
							</div>
						</div>

						<h3>Sticks:</h3>
						<div class={styles.debugGrid}>
							<div class={styles.debugItem}>
								<strong>Left Stick:</strong>
								<br />
								X: {gamepadState().axes[0]?.toFixed(3) || '0.000'}
								<br />
								Y: {gamepadState().axes[1]?.toFixed(3) || '0.000'}
							</div>
							<div class={styles.debugItem}>
								<strong>Right Stick:</strong>
								<br />
								X: {gamepadState().axes[2]?.toFixed(3) || '0.000'}
								<br />
								Y: {gamepadState().axes[3]?.toFixed(3) || '0.000'}
							</div>
						</div>

						{gamepadState().axes.length > 4 && (
							<div>
								<h3>Additional Axes:</h3>
								<For each={gamepadState().axes.slice(4)}>
									{(axis, index) => (
										<div>
											Axis {index() + 4}: {axis.toFixed(3)}
										</div>
									)}
								</For>
							</div>
						)}
					</div>
				</section>
			)}

			{/* Expected Device State Debug */}
			{devices().length > 0 && (
				<section class={styles.section}>
					<h2>Expected Device State</h2>
					<div class={styles.controls}>
						<div class={styles.debugGrid}>
							<For
								each={
									['rightNipple', 'leftNipple', 'clitoris', 'vagina'] as Array<
										Exclude<BodyPart, 'mixed'>
									>
								}
							>
								{(bodyPart) => (
									<div class={styles.debugItem}>
										<strong>
											{bodyPart === 'rightNipple'
												? 'Right Nipple (Y)'
												: bodyPart === 'leftNipple'
													? 'Left Nipple (X)'
													: bodyPart === 'clitoris'
														? 'Clitoris (A)'
														: 'Vagina (B)'}
											:
										</strong>
										<br />
										Strength:{' '}
										{expectedDeviceState()[bodyPart].strength.toFixed(3)}
										<br />
										Rotation:{' '}
										{expectedDeviceState()[bodyPart].rotationSpeed.toFixed(3)}
									</div>
								)}
							</For>
						</div>
					</div>
				</section>
			)}

			{/* Command History Debug */}
			{commandHistory().length > 0 && (
				<section class={styles.section}>
					<h2>Command History (Last 10)</h2>
					<div class={styles.controls}>
						<div class={styles.commandHistory}>
							<For each={commandHistory()}>
								{(entry) => (
									<div class={styles.commandEntry}>
										<div class={styles.commandTimestamp}>
											{new Date(entry.timestamp).toLocaleTimeString()}
										</div>
										<div class={styles.commandDetails}>
											<strong>{entry.deviceName}</strong> →
											<span class={styles.bodyPartLabel}>
												{entry.bodyPart === 'rightNipple'
													? 'Right Nipple'
													: entry.bodyPart === 'leftNipple'
														? 'Left Nipple'
														: entry.bodyPart === 'clitoris'
															? 'Clitoris'
															: entry.bodyPart === 'vagina'
																? 'Vagina'
																: 'Mixed'}
											</span>
										</div>
										<div class={styles.commandAction}>
											{entry.motorType} {entry.motorIndex}: {entry.command}(
											{Array.isArray(entry.value)
												? `[${entry.value.map((v) => v.toFixed(3)).join(', ')}]`
												: entry.value.toFixed(3)}
											)
										</div>
										<div class={styles.commandSource}>
											{entry.source === 'gamepad'
												? '🎮'
												: entry.source === 'sync'
													? '🔄'
													: '✋'}{' '}
											{entry.source}
										</div>
									</div>
								)}
							</For>
						</div>
					</div>
				</section>
			)}

			{/* Device List */}
			<section class={styles.section}>
				<h2>Available Devices & Motor Mapping</h2>
				<Switch>
					<Match when={devices().length === 0}>
						<p>No devices connected</p>
					</Match>
					<Match when={true}>
						<div class={styles.deviceList}>
							<For each={devices()}>
								{(device) => (
									<div class={styles.deviceItem}>
										<h3>{device.name}</h3>

										{/* Vibrators */}
										{device.vibrateAttributes.length > 0 && (
											<div class={styles.motorSection}>
												<h4>Vibrators ({device.vibrateAttributes.length})</h4>
												<For each={device.vibrateAttributes}>
													{(_, vibratorIndex) => (
														<div class={styles.motorItem}>
															<span>Vibrator {vibratorIndex()}</span>
															<div class={styles.deviceControls}>
																<button
																	class={styles.mapButton}
																	onClick={() =>
																		mapMotorToBodyPart(
																			device,
																			vibratorIndex(),
																			'vibrate',
																			'rightNipple',
																		)
																	}
																>
																	→ Right Nipple
																</button>
																<button
																	class={styles.mapButton}
																	onClick={() =>
																		mapMotorToBodyPart(
																			device,
																			vibratorIndex(),
																			'vibrate',
																			'leftNipple',
																		)
																	}
																>
																	→ Left Nipple
																</button>
																<button
																	class={styles.mapButton}
																	onClick={() =>
																		mapMotorToBodyPart(
																			device,
																			vibratorIndex(),
																			'vibrate',
																			'clitoris',
																		)
																	}
																>
																	→ Clitoris
																</button>
																<button
																	class={styles.mapButton}
																	onClick={() =>
																		mapMotorToBodyPart(
																			device,
																			vibratorIndex(),
																			'vibrate',
																			'vagina',
																		)
																	}
																>
																	→ Vagina
																</button>
															</div>
														</div>
													)}
												</For>
											</div>
										)}

										{/* Rotators */}
										{device.rotateAttributes.length > 0 && (
											<div class={styles.motorSection}>
												<h4>Rotators ({device.rotateAttributes.length})</h4>
												<For each={device.rotateAttributes}>
													{(_, rotatorIndex) => (
														<div class={styles.motorItem}>
															<span>Rotator {rotatorIndex()}</span>
															<div class={styles.deviceControls}>
																<button
																	class={styles.mapButton}
																	onClick={() =>
																		mapMotorToBodyPart(
																			device,
																			rotatorIndex(),
																			'rotate',
																			'rightNipple',
																		)
																	}
																>
																	→ Right Nipple
																</button>
																<button
																	class={styles.mapButton}
																	onClick={() =>
																		mapMotorToBodyPart(
																			device,
																			rotatorIndex(),
																			'rotate',
																			'leftNipple',
																		)
																	}
																>
																	→ Left Nipple
																</button>
																<button
																	class={styles.mapButton}
																	onClick={() =>
																		mapMotorToBodyPart(
																			device,
																			rotatorIndex(),
																			'rotate',
																			'clitoris',
																		)
																	}
																>
																	→ Clitoris
																</button>
																<button
																	class={styles.mapButton}
																	onClick={() =>
																		mapMotorToBodyPart(
																			device,
																			rotatorIndex(),
																			'rotate',
																			'vagina',
																		)
																	}
																>
																	→ Vagina
																</button>
															</div>
														</div>
													)}
												</For>
											</div>
										)}
									</div>
								)}
							</For>
						</div>
					</Match>
				</Switch>
			</section>

			{/* Device Mapping Status */}
			<section class={styles.section}>
				<h2>Current Motor Mappings</h2>
				<div class={styles.deviceGrid}>
					<For
						each={
							['rightNipple', 'leftNipple', 'clitoris', 'vagina'] as Array<
								Exclude<BodyPart, 'mixed'>
							>
						}
					>
						{(bodyPart) => (
							<div class={styles.deviceMapping}>
								<strong>
									{bodyPart === 'rightNipple'
										? 'Right Nipple (Y)'
										: bodyPart === 'leftNipple'
											? 'Left Nipple (X)'
											: bodyPart === 'clitoris'
												? 'Clitoris (A)'
												: 'Vagina (B)'}
									:
								</strong>
								{alwaysOnMode().has(bodyPart) && (
									<span class={styles.alwaysOn}> [Always On]</span>
								)}

								<div class={styles.motorMappingList}>
									<Switch>
										<Match
											when={
												!deviceMapping()[bodyPart] ||
												deviceMapping()[bodyPart]!.length === 0
											}
										>
											<div class={styles.noMapping}>No motors mapped</div>
										</Match>
										<Match when={true}>
											<For each={deviceMapping()[bodyPart]}>
												{(mapping) => (
													<div class={styles.mappingItem}>
														<span class={styles.deviceName}>
															{mapping.device.name}
														</span>
														<span class={styles.motorType}>
															{mapping.motorType === 'vibrate'
																? 'Vibrator'
																: 'Rotator'}{' '}
															{mapping.motorIndex}
														</span>
														<button
															class={styles.removeButton}
															onClick={() =>
																removeMotorFromBodyPart(
																	mapping.device,
																	mapping.motorIndex,
																	mapping.motorType,
																	bodyPart,
																)
															}
														>
															×
														</button>
													</div>
												)}
											</For>
										</Match>
									</Switch>
								</div>
							</div>
						)}
					</For>
				</div>
			</section>

			{/* Controls Information */}
			<section class={styles.section}>
				<h2>Controls</h2>
				<div class={styles.controls}>
					<h3>Basic Controls:</h3>
					<ul class={styles.controlsList}>
						<li>
							<strong>A Button:</strong> Clitoris
						</li>
						<li>
							<strong>B Button:</strong> Vagina
						</li>
						<li>
							<strong>X Button:</strong> Left Nipple
						</li>
						<li>
							<strong>Y Button:</strong> Right Nipple
						</li>
						<li>
							<strong>Left Stick Rotation:</strong> Both nipple device rotation
						</li>
					</ul>

					<h3>Special Operations (with Trigger):</h3>
					<ul class={styles.controlsList}>
						<li>
							<strong>Trigger + Stick Up:</strong> Increase global strength
						</li>
						<li>
							<strong>Trigger + Button (1x):</strong> Enable always-on mode
						</li>
						<li>
							<strong>Trigger + Button (2x):</strong> Disable always-on mode
						</li>
					</ul>
				</div>
			</section>
		</div>
	);
};

export default Control;
