# -*- mode: ruby -*-
# vi: set ft=ruby :

# All Vagrant configuration is done below. The "2" in Vagrant.configure
# configures the configuration version (we support older styles for
# backwards compatibility). Please don't change it unless you know what
# you're doing.
Vagrant.configure(2) do |config|
  config.vm.box = "phusion/ubuntu-14.04-amd64"

  config.vm.provision "shell", inline: <<-SHELL
    wget -q -O - https://get.docker.io/gpg | apt-key add -
    echo deb http://get.docker.io/ubuntu docker main > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -q -y --force-yes lxc-docker

    usermod -a -G docker vagrant
    echo "cd /vagrant" >> /home/vagrant/.bash_profile
  SHELL
end
