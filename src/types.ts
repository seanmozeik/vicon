export interface GenerateResult {
	commands: string[];
	explanation: string;
}

export interface ToolContext {
	ffmpeg: {
		installed: boolean;
		version?: string;
		codecs: string[];
		filters: string[];
		bitstreamFilters: string[];
		formats: string[];
	};
	magick: {
		installed: boolean;
		version?: string;
		formats: string[];
	};
}
