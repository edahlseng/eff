/* @flow */

import daggy from "daggy";
import {
	always,
	cond,
	either,
	equals,
	flip,
	lte,
	T,
	test,
	applySpec,
	toLower,
	pipe,
	add,
	identity,
	gte,
	both,
	anyPass,
	isNil,
} from "ramda";

import Eff, { interpreter, send } from "./eff.js";

const Input = daggy.taggedSum("Input", {
	getCharacter: [],
	getKeypress: [],
});

export const getCharacter = always(send(Input.getCharacter));
export const getKeypress = always(send(Input.getKeypress));

const zeroPrefixedKeypress = inputStream =>
	cond([
		[equals("A"), always({ name: "up" })],
		[equals("B"), always({ name: "down" })],
		[equals("C"), always({ name: "right" })],
		[equals("D"), always({ name: "left" })],
		[equals("E"), always({ name: "clear" })],
		[equals("F"), always({ name: "end" })],
		[equals("H"), always({ name: "home" })],
		[T, always({})],
	])(inputStream.read(1));

const controlSequenceKeypress = inputStream =>
	cond([
		[equals("A"), always({ name: "up" })],
		[equals("B"), always({ name: "down" })],
		[equals("C"), always({ name: "right" })],
		[equals("D"), always({ name: "left" })],
		[equals("E"), always({ name: "clear" })],
		[equals("F"), always({ name: "end" })],
		[equals("H"), always({ name: "home" })],
		[T, always({})],
	])(inputStream.read(1));

const escapedKeypress = inputStream =>
	cond([
		[equals(""), always({})],
		[
			either(equals("\b"), equals("\x7f")),
			always({ name: "backspace", meta: true }),
		],
		[equals(" "), always({ name: "space", meta: true, string: " " })],
		[
			test(/[a-zA-Z0-9]/),
			applySpec({ name: toLower, meta: T, shift: test(/[A-Z]/) }),
		],
		[equals("0"), () => zeroPrefixedKeypress(inputStream)],
		[equals("["), () => controlSequenceKeypress(inputStream)],
		[T, always({})],
	])((inputStream.read(1) || "").toString());

const nextKeypress = inputStream => ({
	name: "unknown",
	ctrl: false,
	meta: false,
	shift: false,
	string: "",
	...cond([
		[equals(""), always({})],
		[equals("\r"), always({ name: "return", string: "\r" })],
		[equals("\n"), always({ name: "enter", string: "\n" })],
		[equals("\t"), always({ name: "tab", string: "\t" })],
		[either(equals("\b"), equals("\x7f")), always({ name: "backspace" })],
		[equals(" "), always({ name: "space", string: " " })],
		[equals("\x1b"), () => escapedKeypress(inputStream)],
		[
			// $FlowFixMe
			flip(lte)("\x1a"),
			pipe(
				c => c.charCodeAt(0),
				add(96),
				String.fromCharCode,
				applySpec({
					name: identity,
					ctrl: T,
					string: identity,
				}),
			),
		],
		[
			anyPass([
				both(flip(gte)("a"), flip(lte)("z")),
				c => c.charCodeAt(0) >= 161,
				c => c.charCodeAt(0) >= 33 && c.charCodeAt(0) <= 64,
			]),
			applySpec({ name: identity, string: identity }),
		],
		[
			both(flip(gte)("A"), flip(lte)("Z")),
			applySpec({ name: toLower, shift: T, string: identity }),
		],
		[T, always({})],
	])((inputStream.read(1) || "").toString()),
});

export const interpretInput = (
	inputStream: stream$Readable & { +setRawMode?: boolean => void },
) =>
	interpreter({
		onPure: Eff.Pure,
		predicate: x => Input.is(x),
		handler: inputEffect =>
			inputEffect.cata({
				getCharacter: () => continuation => {
					if (inputStream.setRawMode) inputStream.setRawMode(true); // Needed to get characters *before* `enter` is pressed
					inputStream.setEncoding("utf8");

					inputStream.once("readable", () => continuation(inputStream.read(1)));
				},
				getKeypress: () => continuation => {
					if (inputStream.setRawMode) inputStream.setRawMode(true); // Needed to get characters *before* `enter` is pressed
					inputStream.setEncoding("utf8");

					inputStream.once("readable", () =>
						continuation(nextKeypress(inputStream)),
					);
				},
			}),
	});

export const interpretInputStdIn = interpretInput(process.stdin);
