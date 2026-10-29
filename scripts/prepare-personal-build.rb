#!/usr/bin/env ruby
# Run after pod install, in a disposable checkout. The normal project remains
# unchanged in git; these settings apply only to the personal build pipeline.
require 'xcodeproj'
require 'fileutils'
require 'rexml/document'

root = File.expand_path('..', __dir__)
project = Xcodeproj::Project.open(File.join(root, 'Monal/Monal.xcodeproj'))
app = project.targets.find { |target| target.name == 'Monal' }
abort 'Monal target not found' unless app

bundle_id = 'dev.tobiko.monal.personal'
build_number = ENV.fetch('PERSONAL_BUILD_NUMBER', '1')
abort 'PERSONAL_BUILD_NUMBER must be a positive integer' unless build_number.match?(/\A[1-9][0-9]*\z/)

# The free build is a single app. Remove extension embedding and dependencies,
# including the archive phase which would otherwise inject a push entitlement.
app.copy_files_build_phases.select { |phase| phase.dst_subfolder_spec == '13' }.each(&:remove_from_project)
app.dependencies.select { |dependency| %w[shareSheet NotificationService].include?(dependency.target&.name) }
   .each(&:remove_from_project)
app.shell_script_build_phases.select { |phase| phase.name == 'Fix catalyst aps-enviromnent' }.each(&:remove_from_project)

configurations = project.build_configurations + project.targets.flat_map(&:build_configurations)
configurations.each do |configuration|
  settings = configuration.build_settings
  settings['GCC_PREPROCESSOR_DEFINITIONS'] = (Array(settings.fetch('GCC_PREPROCESSOR_DEFINITIONS', '$(inherited)')) + ['MONAL_SIDELOAD=1']).uniq
  settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = (Array(settings.fetch('SWIFT_ACTIVE_COMPILATION_CONDITIONS', '$(inherited)')) + ['MONAL_SIDELOAD']).uniq
  settings.keys.grep(/\A(?:CODE_SIGN_ENTITLEMENTS|DEVELOPMENT_TEAM|PROVISIONING_PROFILE|PROVISIONING_PROFILE_SPECIFIER|CODE_SIGN_IDENTITY)(?:\[|\z)/).each { |key| settings.delete(key) }
  settings['CODE_SIGN_ENTITLEMENTS'] = ''
  settings['DEVELOPMENT_TEAM'] = ''
  settings['CODE_SIGN_STYLE'] = 'Automatic'
  settings['CODE_SIGN_IDENTITY'] = 'Apple Development'
  settings['CODE_SIGN_IDENTITY[sdk=iphonesimulator*]'] = '-'
  settings['SUPPORTS_MACCATALYST'] = 'NO'
end

app.build_configurations.each do |configuration|
  settings = configuration.build_settings
  settings.keys.grep(/\APRODUCT_BUNDLE_IDENTIFIER\[/).each { |key| settings.delete(key) }
  settings['PRODUCT_BUNDLE_IDENTIFIER'] = bundle_id
  settings['INFOPLIST_FILE'] = 'build/personal/Monal-Personal-Info.plist'
  settings['INFOPLIST_KEY_CFBundleDisplayName'] = 'Monal Personal'
  settings['CURRENT_PROJECT_VERSION'] = build_number
end
project.targets.select { |target| target.name.end_with?('Tests') }.each do |target|
  target.build_configurations.each do |configuration|
    configuration.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = "#{bundle_id}.#{target.name}"
  end
end
attributes = project.root_object.attributes.fetch('TargetAttributes', {})
attributes.each_value { |value| value['SystemCapabilities'] = {} if value.key?('SystemCapabilities') }
project.save

info = Xcodeproj::Plist.read_from_path(File.join(root, 'Monal/Monal-Info.plist'))
info['CFBundleDisplayName'] = 'Monal Personal'
info['UIBackgroundModes'] -= ['remote-notification', 'voip']
# Leave xmpp links with the user's regular client while testing this fork.
info.delete('CFBundleURLTypes')
directory = File.join(root, 'Monal/build/personal')
FileUtils.mkdir_p(directory)
Xcodeproj::Plist.write_to_path(info, File.join(directory, 'Monal-Personal-Info.plist'))

# Disable only test-time Guard Malloc in this checkout, as in normal CI.
scheme_path = File.join(root, 'Monal/Monal.xcodeproj/xcshareddata/xcschemes/Monal.xcscheme')
scheme = REXML::Document.new(File.read(scheme_path))
REXML::XPath.each(scheme, '//TestAction/EnvironmentVariables/EnvironmentVariable') do |variable|
  variable.attributes['isEnabled'] = 'NO' if variable.attributes['key'] == 'DYLD_INSERT_LIBRARIES'
end
File.write(scheme_path, scheme.to_s)
puts "Prepared #{bundle_id} (build #{build_number}) without extensions, push, or shared containers."
