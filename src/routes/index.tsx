import {
	createEffect,
	createSignal,
	For,
	Match,
	onCleanup,
	Switch,
	type Component,
} from 'solid-js';
import {ButtplugWasmClientConnector} from 'buttplug-wasm/dist/buttplug-wasm.mjs';
import {ButtplugClient, type ButtplugClientDevice} from 'buttplug';

import styles from './index.module.css';

const initializeFrequency = async () => {
	const audioContext = new AudioContext();
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {noiseSuppression: false},
	});

	const source = audioContext.createMediaStreamSource(stream);
	const analyser = audioContext.createAnalyser();
	const fftSize = 4096;
	analyser.fftSize = fftSize;
	analyser.minDecibels = -100;
	analyser.smoothingTimeConstant = 0;
	source.connect(analyser);
	const bufferLength = analyser.frequencyBinCount;
	const dataArray = new Uint8Array(bufferLength);
	analyser.getByteTimeDomainData(dataArray);
	const frequency = () => {
		analyser.getByteFrequencyData(dataArray);

		// Cut out the frequencies above threshold
		const frequencies = dataArray.slice(
			0,
			3000 / (audioContext.sampleRate / fftSize),
		);

		// Get the frequency with the highest volume
		const maxVolume = Math.max(...frequencies);
		const maxIndex = frequencies.indexOf(maxVolume);
		const maxFrequency = maxIndex * (audioContext.sampleRate / fftSize);

		return {
			maxFrequency,
			maxVolume,
			frequencies,
			sampleRate: audioContext.sampleRate,
			fftSize,
		};
	};
	return frequency;
};

type VibrateMode = 'ex' | 'in' | 'random-in' | 'both';

const Index: Component = () => {
	const [buttplugClient, setButtplugClient] =
		createSignal<ButtplugClient | null>(null);
	const [devices, setDevices] = createSignal<ButtplugClientDevice[]>([]);
	const [toyStrength, setToyStrength] = createSignal(0);
	const [viewport, setViewport] = createSignal({
		width: window.innerWidth,
		height: window.innerHeight,
	});
	const [volumeThreshold, setVolumeThreshold] = createSignal(100);
	const [minFrequencyThreshold, setMinFrequencyThreshold] = createSignal(100);
	const [maxFrequencyThreshold, setMaxFrequencyThreshold] = createSignal(600);
	const [minStrength, setMinStrength] = createSignal(0);
	const [vibrateMode, setVibrateMode] = createSignal<VibrateMode>('ex');
	const [randomStrength, setRandomStrength] = createSignal(0);

	let onClickStartMic!: () => void;

	const getFrequencyPromise = new Promise((resolve) => {
		onClickStartMic = async () => {
			const getFrequency = await initializeFrequency();
			resolve(getFrequency);
		};
	});

	let canvasEl!: HTMLCanvasElement;

	const timer = setInterval(async () => {
		const getFrequency = await getFrequencyPromise;
		const frequencyData = getFrequency();

		console.log(frequencyData.maxVolume, frequencyData.maxFrequency);

		const isTurnedOn =
			frequencyData.maxVolume > volumeThreshold() &&
			frequencyData.maxFrequency > minFrequencyThreshold() &&
			frequencyData.maxFrequency < maxFrequencyThreshold();
		setToyStrength((prev) => {
			if (prev === 0 && isTurnedOn) {
				console.log('Turning on');
				return 1;
			}
			if (prev === 1 && !isTurnedOn) {
				console.log('Turning off');
				return 0;
			}
			return prev;
		});

		// Draw the frequency data
		const canvas = canvasEl;
		const ctx = canvas.getContext('2d')!;
		const width = canvas.width;
		const height = canvas.height;

		ctx.fillStyle = 'rgb(200, 200, 200)';
		ctx.fillRect(0, 0, width, height);

		// Draw the rectangle illustrating the range from 800 to 1000 Hz
		const indexFrom = Math.floor(
			minFrequencyThreshold() /
				(frequencyData.sampleRate / frequencyData.fftSize),
		);
		const indexTo = Math.floor(
			maxFrequencyThreshold() /
				(frequencyData.sampleRate / frequencyData.fftSize),
		);
		ctx.fillStyle = 'rgb(255, 150, 150)';
		ctx.fillRect(
			(indexFrom / frequencyData.frequencies.length) * width,
			0,
			((indexTo - indexFrom) / frequencyData.frequencies.length) * width,
			height,
		);

		ctx.fillStyle = 'rgb(150, 255, 150)';
		ctx.fillRect(
			(indexFrom / frequencyData.frequencies.length) * width,
			(volumeThreshold() / 128) * (height / 2),
			((indexTo - indexFrom) / frequencyData.frequencies.length) * width,
			height,
		);

		ctx.lineWidth = 2;
		ctx.strokeStyle = 'rgb(0, 0, 0)';
		ctx.beginPath();

		const sliceWidth = (width * 1.0) / frequencyData.frequencies.length;
		let x = 0;

		for (let i = 0; i < frequencyData.frequencies.length; i++) {
			const v = frequencyData.frequencies[i] / 128.0;
			const y = (v * height) / 2;

			if (i === 0) {
				ctx.moveTo(x, y);
			} else {
				ctx.lineTo(x, y);
			}

			x += sliceWidth;
		}

		ctx.lineTo(width, height / 2);
		ctx.stroke();

		// Draw the point at the frequency with the highest volume
		const maxVolume = Math.max(...frequencyData.frequencies);
		const maxIndex = frequencyData.frequencies.indexOf(maxVolume);
		ctx.fillStyle = 'rgb(255, 0, 0)';
		ctx.fillRect(
			(maxIndex / frequencyData.frequencies.length) * width - 5,
			(maxVolume / 128) * (height / 2) - 5,
			10,
			10,
		);
	}, 100);
	onCleanup(() => clearInterval(timer));

	createEffect(() => {
		const toyStrengthValue = Math.max(toyStrength(), minStrength());
		const devicesValue = devices();

		for (const device of devicesValue) {
			if (device.vibrateAttributes.length > 0) {
				if (device.name === 'ToyCod Tara X') {
					if (vibrateMode() === 'ex') {
						device.vibrate([0, toyStrengthValue]);
					} else if (vibrateMode() === 'in') {
						device.vibrate([toyStrengthValue, 0]);
					} else if (vibrateMode() === 'random-in') {
						device.vibrate([randomStrength(), toyStrengthValue]);
					} else {
						device.vibrate([toyStrengthValue, toyStrengthValue]);
					}
				} else {
					device.vibrate(toyStrengthValue);
				}
			}
			if (device.rotateAttributes.length > 0) {
				device.rotate(toyStrengthValue, true);
			}
		}
	});

	const onResize = () => {
		setViewport({width: window.innerWidth, height: window.innerHeight});
	};
	window.addEventListener('resize', onResize);
	onCleanup(() => window.removeEventListener('resize', onResize));

	const randomizeStrengthTimer = setInterval(() => {
		if (Math.random() < 0.3) {
			setRandomStrength(0);
		} else {
			setRandomStrength(Math.random() * 0.3);
		}
		console.log(`Random strength: ${randomStrength()}`);
	}, 1500);
	onCleanup(() => clearInterval(randomizeStrengthTimer));

	const onDeviceAdded = (device: ButtplugClientDevice) => {
		console.log(`Device added: ${device.name}`);
		console.log(`Device messages: ${JSON.stringify(device.messageAttributes)}`);
		console.log(
			`Rotate attributes: ${JSON.stringify(device.rotateAttributes)}`,
		);
		console.log(
			`Vibrate attributes: ${JSON.stringify(device.vibrateAttributes)}`,
		);

		setDevices((prev) => [...prev, device]);
	};

	const onClickConnect = async () => {
		if (buttplugClient() === null) {
			const client = new ButtplugClient('Test Client');
			await ButtplugWasmClientConnector.activateLogging();
			await client.connect(new ButtplugWasmClientConnector());
			setButtplugClient(client);
		}

		const client = buttplugClient()!;
		await client.startScanning();

		client.addListener('deviceadded', onDeviceAdded);
	};

	return (
		<ul class={styles.tasks}>
			<button type="button" onClick={onClickConnect}>
				connect
			</button>
			<button type="button" onClick={onClickStartMic}>
				start mic
			</button>
			<Switch>
				<Match when={buttplugClient() === null}>
					<p>No client</p>
				</Match>
				<Match when={true}>
					<ul>
						<For each={devices()}>{(device) => <li>{device.name}</li>}</For>
					</ul>
				</Match>
			</Switch>
			<canvas
				class={styles.canvas}
				width={viewport().width}
				height="200"
				ref={canvasEl}
			/>
			<div class={styles.controls}>
				<div class={styles.param}>
					Volume threshold
					<div class={styles.control}>
						<button
							type="button"
							class={styles.changeButton}
							onClick={() => setVolumeThreshold((prev) => prev + 5)}
						>
							+
						</button>
						<div class={styles.currentValue}>{volumeThreshold()}</div>
						<button
							type="button"
							class={styles.changeButton}
							onClick={() => setVolumeThreshold((prev) => prev - 5)}
						>
							-
						</button>
					</div>
				</div>
				<div class={styles.param}>
					Min freq.
					<div class={styles.control}>
						<button
							type="button"
							class={styles.changeButton}
							onClick={() => setMinFrequencyThreshold((prev) => prev + 50)}
						>
							+
						</button>
						<div class={styles.currentValue}>{minFrequencyThreshold()}</div>
						<button
							type="button"
							class={styles.changeButton}
							onClick={() => setMinFrequencyThreshold((prev) => prev - 50)}
						>
							-
						</button>
					</div>
				</div>
				<div class={styles.param}>
					Max freq.
					<div class={styles.control}>
						<button
							type="button"
							class={styles.changeButton}
							onClick={() => setMaxFrequencyThreshold((prev) => prev + 50)}
						>
							+
						</button>
						<div class={styles.currentValue}>{maxFrequencyThreshold()}</div>
						<button
							type="button"
							class={styles.changeButton}
							onClick={() => setMaxFrequencyThreshold((prev) => prev - 50)}
						>
							-
						</button>
					</div>
				</div>
			</div>
			<div class={styles.controls}>
				<div class={styles.param}>
					Min strength
					<div class={styles.control}>
						<button
							type="button"
							class={styles.changeButton}
							onClick={() => setMinStrength((prev) => Math.min(1, prev + 0.1))}
						>
							+
						</button>
						<div class={styles.currentValue}>{minStrength()}</div>
						<button
							type="button"
							class={styles.changeButton}
							onClick={() => setMinStrength((prev) => Math.max(0, prev - 0.1))}
						>
							-
						</button>
					</div>
				</div>
				<div class={styles.param}>
					Vibrate mode
					<div class={styles.control}>
						<For each={['ex', 'in', 'random-in', 'both'] as VibrateMode[]}>
							{(mode) => (
								<button
									type="button"
									classList={{
										[styles.changeButton]: true,
										[styles.selected]: vibrateMode() === mode,
									}}
									onClick={() => setVibrateMode(mode)}
								>
									{mode}
								</button>
							)}
						</For>
					</div>
				</div>
			</div>
		</ul>
	);
};

export default Index;
