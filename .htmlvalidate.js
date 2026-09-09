/**
 * html-validate rules for biassp.github.io.
 *
 * Two rules from the recommended set are switched off deliberately, and only
 * these two — everything else is enforced.
 *
 * no-inline-style
 *   The CV is a single file with no build step, on purpose. A handful of
 *   one-off spacing values sit on the element rather than growing the
 *   stylesheet with single-use classes. This is a house-style rule, not a
 *   correctness one.
 *
 * prefer-native-element
 *   HARvest's drop zone is a <div role="button" tabindex="0">. It is a
 *   drag-and-drop target first and a click target second, and it is already
 *   keyboard-operable. Swapping in a native <button> would change nothing a
 *   user can perceive.
 */
module.exports = {
  extends: ["html-validate:recommended"],
  rules: {
    "no-inline-style": "off",
    "prefer-native-element": "off",
  },
};
