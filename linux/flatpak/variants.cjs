const id = "io.github.apollovulpez.aurral-app";
const name = "Aurral App";

module.exports = {
  stable: { id, name, branch: "stable", suffix: "" },
  testing: { id: `${id}-testing`, name: `${name} Testing`, branch: "testing", suffix: "-testing", updateChannel: "flatpak-testing" },
};
