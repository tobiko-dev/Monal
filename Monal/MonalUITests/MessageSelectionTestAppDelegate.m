#import "MessageSelectionTestAppDelegate.h"

#if DEBUG && TARGET_OS_SIMULATOR
#import <monalxmpp/DataLayer.h>
#import <monalxmpp/HelperTools.h>
#import <monalxmpp/MLContact.h>
#import <monalxmpp/MLVoIPProcessor.h>
#import <monalxmpp/MLXMPPManager.h>
#import <Monal-Swift.h>
#import "chatViewController.h"

@implementation MessageSelectionTestAppDelegate

-(BOOL) application:(UIApplication*) application didFinishLaunchingWithOptions:(NSDictionary*) launchOptions
{
    // The UI tests pass --reset to main.m and run in a disposable simulator.
    // Refuse to seed an existing account database, even in a debug simulator.
    DataLayer* db = [DataLayer sharedInstance];
    MLAssert(db.accountCnts.intValue == 0, @"Message selection tests require an empty database");
    MLXMPPManager* manager = [MLXMPPManager sharedInstance];
    manager.isConnectBlocked = YES;
    NSNumber* accountID = [db addAccountWithDictionary:@{
        kUsername: @"selection-test", kDomain: @"example.invalid",
        kResource: @"ui-tests", kServer: @"example.invalid", kPort: @"5222",
        kEnabled: @NO, kDirectTLS: @NO,
    }];
    MLAssert(accountID != nil, @"Could not seed the test account");
    NSString* fixturePassword = [NSString stringWithFormat:@"unused-offline-fixture-%@", [NSUUID UUID].UUIDString];
    [manager updatePassword:fixturePassword forAccount:accountID];
#ifdef MONAL_SIDELOAD
    // Exercise the real keychain API in the app, whose signing identity grants
    // its private access group. Unhosted framework tests have no app identity.
    // A fresh value each launch prevents a stale keychain item masking a failed write.
    MLAssert([manager isValidPassword:fixturePassword forAccount:accountID],
        @"Personal app could not store and retrieve its account password");
#endif
    [manager connectAccount:accountID];  // Instantiates the disabled account without connecting.
    MLAssert([manager getEnabledAccountForID:accountID] != nil, @"Could not load the test account");

    NSString* jid = @"friend@example.invalid";
    [db addContact:jid forAccount:accountID nickname:@"Selection Test"];
    MLContact* contact = [MLContact createContactFromJid:jid andAccountID:accountID];
    [contact toggleEncryption:NO];
    [contact markReachedMamArchiveTop];
    NSString* text = @"Alpha bravo café 👩🏽‍💻\nSecond line: 日本語 — https://example.org/test\nFinal line.";
    [db addMessageToChatBuddy:jid withInboundDir:YES forAccount:accountID withBody:text
        actuallyfrom:jid occupantId:nil participantJid:nil sent:YES unread:NO
        messageId:@"selection-fixture" serverMessageId:@"selection-fixture"
        messageType:kMessageTypeText andOverrideDate:[NSDate date] encrypted:NO
        displayMarkerWanted:NO usingHistoryId:nil checkForDuplicates:YES];
    [db saveMessageDraft:jid forAccount:accountID withComment:@"Unsent draft"];
    [[HelperTools defaultsDB] setBool:NO forKey:@"SendLastChatState"];
    [[HelperTools defaultsDB] setBool:NO forKey:@"showKeyboardOnChatOpen"];
    [[HelperTools defaultsDB] setBool:NO forKey:@"ShowURLPreview"];
    self.voipProcessor = [MLVoIPProcessor new];

    UIViewController* root;
    if([NSProcessInfo.processInfo.arguments containsObject:@"--ui-test-legacy-chat"])
    {
        chatViewController* chat = [[UIStoryboard storyboardWithName:@"Main" bundle:nil]
            instantiateViewControllerWithIdentifier:@"chatViewController"];
        [chat setupWithContact:contact];
        root = [[UINavigationController alloc] initWithRootViewController:chat];
    }
    else
        root = [SwiftuiInterface makeMessageSelectionTestChatFor:contact];
    self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
    self.window.rootViewController = root;
    [self.window makeKeyAndVisible];
    return YES;
}

// These tests exercise the chat UI, without notification registration, crash
// reporting prompts, or foreground/background account reconnection.
-(void) applicationDidBecomeActive:(UIApplication*) application {}
-(void) applicationWillResignActive:(UIApplication*) application {}
-(void) applicationDidEnterBackground:(UIApplication*) application {}
-(void) applicationWillEnterForeground:(UIApplication*) application {}

@end
#endif
