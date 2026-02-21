class Vicon < Formula
  desc "AI-powered media conversion CLI — describe what you want, get the commands"
  homepage "https://github.com/seanmozeik/vicon"
  version "0.1.0"
  license "MIT"

  # URL to bundled source (single JS file)
  url "https://github.com/seanmozeik/vicon/releases/download/v#{version}/vicon-#{version}.tar.gz"
  sha256 "3c289848c6f02496c9b6ff730e02a85dd03d55bc0529e8501f539e359d678f93"

  depends_on "oven-sh/bun/bun"

  on_linux do
    depends_on "libsecret"
  end

  def install
    # Install all bundled files to libexec
    libexec.install Dir["*"]

    # Create wrapper script
    (bin/"vicon").write <<~EOS
      #!/bin/bash
      exec "#{Formula["bun"].opt_bin}/bun" "#{libexec}/index.js" "$@"
    EOS
  end

  test do
    assert_match "vicon", shell_output("#{bin}/vicon --help")
  end
end
