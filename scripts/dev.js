import { generateTypes } from "https://deno.land/x/deno_tsc_helper@v0.3.0/mod.js";
// This import exists just to make sure AdLad types are vendored.
// deno-lint-ignore no-unused-vars
import { AdLad } from "$adlad";

import { setCwd } from "$chdir_anywhere";
setCwd(import.meta.url);
Deno.chdir("..");

generateTypes({
	outputDir: ".denoTypes",
	importMap: "importmap.json",
	include: [
		"scripts",
		"src",
		// "test",
	],
});
