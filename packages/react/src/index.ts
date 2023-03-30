/**
 * This is an aliased inline copy of @preact/signals-react.
 * It fixes an oversight in the recent releases that caused
 * incompatibility with React Router 6.
 */

import {
	useRef,
	useMemo,
	useEffect,
	// @ts-ignore-next-line
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED as internals,
} from "react";
import React from "react";
import {
	signal,
	computed,
	batch,
	effect,
	Signal,
	type ReadonlySignal,
} from "@preact/signals-core";
import jsxRuntime from "react/jsx-runtime";
import type { Effect } from "./internal";

interface ReactOwner {
	_: never;
}

interface ReactDispatcher {
	useCallback(): unknown;
}

export { signal, computed, batch, effect, Signal, type ReadonlySignal };

/**
 * Install a middleware into React.createElement to replace any Signals in props with their value.
 */
React.createElement = wrap(React.createElement);
// @ts-ignore-next-line
jsxRuntime.jsx = wrap(jsxRuntime.jsx);
// @ts-ignore-next-line
jsxRuntime.jsxs = wrap(jsxRuntime.jsxs);
// @ts-ignore-next-line
jsxRuntime.jsxDEV = wrap(jsxRuntime.jsxDEV);

function wrap(fn: any) {
	return function (this: any, type: any, props: any) {
		if (typeof type === "string" && props) {
			for (let i in props) {
				let v = props[i];
				if (i !== "children" && v instanceof Signal) {
					props[i] = v.value;
				}
			}
		}
		return fn.apply(this, arguments);
	};
}

/*
// This breaks React's controlled components implementation
function createPropUpdater(props: any, prop: string, signal: Signal) {
	let ref = props.ref;
	if (!ref) ref = props.ref = React.createRef();
	effect(() => {
		if (props) props[prop] = signal.value;
		let el = ref.current;
		if (!el) return; // unsubscribe
		(el as any)[prop] = signal.value;
	});
	props = null;
}
*/

let finishUpdate: (() => void) | undefined;
const updaterForComponent = new WeakMap<ReactOwner, Effect>();

function setCurrentUpdater(updater?: Effect) {
	// end tracking for the current update:
	if (finishUpdate) finishUpdate();
	// start tracking the new update:
	finishUpdate = updater && updater._start();
}

function createUpdater(update: () => void) {
	let updater!: Effect;
	effect(function (this: Effect) {
		updater = this;
	});
	updater._callback = update;
	return updater;
}

/**
 * A wrapper component that renders a Signal's value directly as a Text node.
 */
function Text({ data }: { data: Signal }) {
	return data.value;
}

// Decorate Signals so React renders them as <Text> components.
//@ts-ignore-next-line
const $$typeof = React.createElement("a").$$typeof;
Object.defineProperties(Signal.prototype, {
	$$typeof: { configurable: true, value: $$typeof },
	type: { configurable: true, value: Text },
	props: {
		configurable: true,
		get() {
			return { data: this };
		},
	},
	ref: { configurable: true, value: null },
});

// Track the current owner (roughly equiv to current vnode)
let lastOwner: ReactOwner | undefined;
let currentOwner: ReactOwner | null = null;
Object.defineProperty(internals.ReactCurrentOwner, "current", {
	get() {
		return currentOwner;
	},
	set(owner) {
		// TODO: Doesn't work in production build of React :( React only sets the
		// current owner for class components in the production build.
		currentOwner = owner;
		if (currentOwner) lastOwner = currentOwner;
	},
});

// Track the current dispatcher (roughly equiv to current component impl)
let lock = false;
const UPDATE = () => ({});
let currentDispatcher: ReactDispatcher;
Object.defineProperty(internals.ReactCurrentDispatcher, "current", {
	get() {
		return currentDispatcher;
	},
	set(api) {
		currentDispatcher = api;
		if (lock) return;
		if (lastOwner && api && !isInvalidHookAccessor(api)) {
			// prevent re-injecting useReducer when the Dispatcher
			// context changes to run the reducer callback:
			lock = true;
			// TODO: Downside: this will add a useReducer call after every usage of
			// useReducer, useState, or useMemo hook in components since these hooks
			// change the Dispatcher in development mode. Could work around by
			// specifically detecting the ContextOnlyDispatcher instead of any
			// erroring dispatcher.
			const rerender = api.useReducer(UPDATE, {})[1];
			lock = false;

			let updater = updaterForComponent.get(lastOwner);
			if (!updater) {
				updater = createUpdater(rerender);
				updaterForComponent.set(lastOwner, updater);
			} else {
				updater._callback = rerender;
			}
			setCurrentUpdater(updater);
		} else {
			setCurrentUpdater();
		}
	},
});

// We inject a useReducer into every function component via CurrentDispatcher.
// This prevents injecting into anything other than a function component render.
const invalidHookAccessors = new Map();
function isInvalidHookAccessor(api: ReactDispatcher) {
	const cached = invalidHookAccessors.get(api);
	if (cached !== undefined) return cached;
	// we only want the real implementation, not the warning ones
	const invalid =
		api.useCallback.length < 2 ||
		/warnInvalidHookAccess/.test(api.useCallback as any);
	invalidHookAccessors.set(api, invalid);
	return invalid;
}

export function useSignal<T>(value: T) {
	return useMemo(() => signal<T>(value), []);
}

export function useComputed<T>(compute: () => T) {
	const $compute = useRef(compute);
	$compute.current = compute;
	return useMemo(() => computed<T>(() => $compute.current()), []);
}

export function useSignalEffect(cb: () => void | (() => void)) {
	const callback = useRef(cb);
	callback.current = cb;

	useEffect(() => {
		return effect(() => {
			return callback.current();
		});
	}, []);
}
