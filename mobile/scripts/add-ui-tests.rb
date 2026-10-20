require 'xcodeproj'
require 'fileutils'
FileUtils.mkdir_p(File.expand_path('../ios/HaskappUITests', __dir__))
FileUtils.cp(File.expand_path('../native-tests/HaskappUITests.swift', __dir__), File.expand_path('../ios/HaskappUITests/HaskappUITests.swift', __dir__))
project_path = File.expand_path('../ios/Haskapp.xcodeproj', __dir__)
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |t| t.name == 'Haskapp' }
test = project.targets.find { |t| t.name == 'HaskappUITests' } || project.new_target(:ui_test_bundle, 'HaskappUITests', :ios, '16.4')
unless test.source_build_phase.files.any? { |f| f.file_ref.path.end_with?('HaskappUITests.swift') }
  group = project.main_group.find_subpath('HaskappUITests', true)
  group.set_source_tree('<group>')
  ref = group.new_file('HaskappUITests.swift')
  test.source_build_phase.add_file_reference(ref)
end
test.add_dependency(app) unless test.dependencies.any? { |d| d.target == app }
test.build_configurations.each do |c|
  c.build_settings['PRODUCT_NAME'] = 'HaskappUITests'
  c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'jp.haskapp.ios.uitests'
  c.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  c.build_settings['SWIFT_VERSION'] = '5.0'
  c.build_settings['TEST_TARGET_NAME'] = 'Haskapp'
  c.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
end
project.main_group.find_subpath('HaskappUITests', true).path = 'HaskappUITests'
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(test)
scheme.set_launch_target(app)
scheme.test_action.build_configuration = 'Release'
scheme.launch_action.build_configuration = 'Release'
scheme.save_as(project_path, 'Haskapp', true)
