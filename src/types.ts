export interface GenerateResult {
	commands: string[];
	explanation: string;
}

export interface ToolContext {
	ffmpeg: {
		installed: boolean;
		version?: string;
		videoEncoders: string[];
		audioEncoders: string[];
		decoders: string[];
	};
	magick: {
		installed: boolean;
		version?: string;
		formats: string[];
	};
}
