import {FirebaseProvider} from 'solid-firebase';
import {Suspense} from 'solid-js';
import {Router} from '@solidjs/router';
import {FileRoutes} from '@solidjs/start/router';
import app from '~/lib/firebase';
import './app.css';

export default function App() {
	return (
		<FirebaseProvider app={app}>
			<Router root={(props) => <Suspense>{props.children}</Suspense>}>
				<FileRoutes />
			</Router>
		</FirebaseProvider>
	);
}