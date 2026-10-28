#import "MonalAppDelegate.h"

#if DEBUG && TARGET_OS_SIMULATOR
// Compiled into simulator debug builds only. Selected explicitly by the UI tests.
@interface MessageSelectionTestAppDelegate : MonalAppDelegate
@end
#endif
