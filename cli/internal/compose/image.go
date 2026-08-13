package compose

// ImageRepo is the app image repository. The tag is MATHION_VERSION in .env.
// image_test.go asserts this is the prefix of the image line in ComposeYAML so
// the constant and the embedded compose file cannot silently drift.
const ImageRepo = "ghcr.io/svkucheryavski/mathion"
