Pod::Spec.new do |s|
  s.name = 'fliwright_design_qa'
  s.version = '0.1.0'
  s.summary = 'Fliwright-owned Design QA platform channels.'
  s.description = <<-DESC
Accelerometer and transport channel support for the Fliwright Design QA SDK.
DESC
  s.homepage = 'https://github.com/0x01lab/fliwright'
  s.license = { :type => 'MIT', :file => '../LICENSE' }
  s.author = { '0x01lab' => 'engineering@0x01lab.com' }
  s.source = { :http => 'https://github.com/0x01lab/fliwright' }
  s.source_files = 'Classes/**/*'
  s.dependency 'Flutter'
  s.frameworks = 'CoreMotion'
  s.platform = :ios, '13.0'
  s.swift_version = '5.0'
end
