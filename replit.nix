{ pkgs }: {
  deps = [
    pkgs.wget
    pkgs.ffmpeg.bin
    pkgs.yt-dlp-light
    pkgs.python39Packages.pip
    pkgs.zip
    pkgs.ffmpeg
    pkgs.nodejs-16_x
    pkgs.nodePackages.vscode-langservers-extracted
    pkgs.nodePackages.typescript-language-server
  ];
}